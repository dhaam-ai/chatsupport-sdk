/// The session and CSAT endpoints — the Dart mirror of
/// `@dhaam-ccrm/rest`'s `createSessionActions` and
/// `createSessionSummarySource`.
///
/// ── Why an extension and not methods on `RestClient` ──────────────────────
///
/// The contract (§5.9) is explicit that these are methods on ONE class rather
/// than five factory objects: TS splits them because `createChatClient(...)`
/// accepts five independently-substitutable structural seams, and nothing in
/// this workspace composes a Dart `ChatClient` and a REST layer behind such a
/// function. Five wrapper classes each holding the same `RestClient` and
/// forwarding to it would be ceremony with no consumer to justify it.
///
/// An `extension` is how that call shape — `client.listSessions(...)` — is
/// reached without `client.dart` itself growing an endpoint list. That file
/// owns the base path, the two credentials and the failure taxonomy; every
/// route this package speaks is built on the one primitive it exposes,
/// [RestClient.request], which is public precisely so this file needs nothing
/// private from it. Keeping the two apart also means the transport can be read
/// end to end without scrolling past six endpoints, and endpoints can be added
/// without reopening the module every one of them depends on.
///
/// ── The five methods, and what each costs on the wire ─────────────────────
///
/// | Method | Round trips |
/// |---|---|
/// | [SessionApi.closeSession] | 2 — POST, then the `/full` read-back |
/// | [SessionApi.reopenSession] | 2 — same, on the id the receipt settled on |
/// | [SessionApi.submitCsat] | 1 — a rating changes no session state |
/// | [SessionApi.getCsat] | 1 |
/// | [SessionApi.listSessions] | 1, or 0 when `limit` is out of range |
library;

import 'client.dart';
import 'errors.dart';
import 'internal/envelope.dart';
import 'internal/json_reading.dart';
import 'internal/limits.dart';
import 'internal/session_decode.dart';
import 'internal/session_summary_decode.dart';
import 'models/csat.dart';
import 'models/session.dart';
import 'models/session_summary.dart';

/// Route names, exactly as they reach a [RestMalformedResponseException].
///
/// Constants rather than strings built at each throw site: the `context` on a
/// malformed-response failure must be a caller-side literal with no request or
/// response content in it, and a route name that is never interpolated is how
/// that stays true by construction rather than by review.
const String _kListSessionsRoute = 'GET /chat/sessions/customer';
const String _kSubmitCsatRoute = 'POST /chat/sessions/{sessionId}/csat';
const String _kGetCsatRoute = 'GET /chat/sessions/{sessionId}/csat';
const String _kCloseRoute = 'POST /chat/sessions/{sessionId}/close';
const String _kReopenRoute = 'POST /chat/sessions/{sessionId}/reopen';
const String _kFullSessionRoute = 'GET /chat/sessions/{sessionId}/full';

/// The session and CSAT surface of chat-service, on [RestClient].
///
/// In scope for anything that imports `package:dhaam_chat_rest/dhaam_chat_rest.dart`
/// — the barrel re-exports this extension by name, and `test/barrel_test.dart`
/// asserts that the re-export actually carries it, because "a named extension
/// survives an `export`" is a language property worth pinning rather than
/// assuming.
extension SessionApi on RestClient {
  /// `POST /chat/sessions/{id}/close`, then a read-back of
  /// `GET /chat/sessions/{id}/full` — TWO round trips, never one.
  ///
  /// ── Do not collapse this ────────────────────────────────────────────────
  ///
  /// The mutating route returns a RECEIPT (`{sessionId, status, closedAt}`),
  /// not the enriched session a caller needs: no assigned agent, no customer
  /// profile, no ticket. A caller handed the receipt would render a session
  /// whose nameplate and ticket link had silently emptied at exactly the
  /// moment the conversation ended.
  ///
  /// ── The read-back retries; the MUTATION never does ──────────────────────
  ///
  /// Only the `GET` is retried, up to [kReadBackAttempts] times, and only
  /// while the failure says a retry could plausibly differ. The POST is issued
  /// exactly once because closing is NOT idempotent: a second one re-runs the
  /// status update, re-marks participants as having left, and emits both a
  /// fresh "chat closed" SYSTEM message and another Kafka event — all of it
  /// visible in the customer's own transcript.
  ///
  /// There is no delay between attempts. This package has no clock seam, and
  /// adding one would put an untestable timer inside an adapter whose
  /// scheduling belongs to whoever owns the retry policy. The attempts cover
  /// what is worth covering — one dropped connection, one 5xx from a replica
  /// that has not caught up — and anything more persistent is reported rather
  /// than waited on.
  ///
  /// Throws [RestSessionReadBackException] when every attempt fails. That is a
  /// DIFFERENT outcome from a failed close, and the two demand opposite
  /// recoveries: the session HAS changed on the server, so retrying the whole
  /// action is specifically wrong, while re-issuing just this read is
  /// specifically right.
  Future<RestChatSession> closeSession(String sessionId) =>
      _mutateThenReadBack(this, 'close', sessionId, _kCloseRoute);

  /// `POST /chat/sessions/{id}/reopen`, then the same read-back
  /// [closeSession] performs.
  ///
  /// The id that gets read back comes from the mutation's own RECEIPT, not
  /// from the request: reopen may converge onto a different, already-active
  /// session and return that one's id. Re-reading the requested id would then
  /// hand back the wrong session — and the convergence stays inside the
  /// authorization boundary, so the id that comes back is safe to follow.
  ///
  /// A converged id is NOT an error. A caller that treated a differing id as
  /// one would fail the exact case the route added convergence for: a customer
  /// reopening a conversation that another tab has already reopened.
  Future<RestChatSession> reopenSession(String sessionId) =>
      _mutateThenReadBack(this, 'reopen', sessionId, _kReopenRoute);

  /// `POST /chat/sessions/{id}/csat` — an upsert, safe to call again for the
  /// same session.
  ///
  /// ── ONE round trip, deliberately unlike close/reopen ────────────────────
  ///
  /// The route's own response already carries the whole rating
  /// (`{success: true, data: record}`, answered straight from `submitCsat`'s
  /// return value), so there is no partial receipt here needing a `/full` read
  /// to complete — and nothing about a rating changes a session's state for
  /// such a read to refresh. Adding one would spend a round trip on the last
  /// interaction of a conversation fetching a session nothing has altered.
  ///
  /// ── [comment] is OMITTED when there is none, never sent as null ─────────
  ///
  /// The body stays an honest record of what the customer actually typed. An
  /// explicit `comment: null` asserts that they were asked and declined, in a
  /// way an absent key does not.
  ///
  /// One notch stricter than TS, on purpose: TS omits only `undefined`, so an
  /// empty string reaches the wire as `comment: ''`. This treats `''` and
  /// `null` alike, because an empty string is not something a customer typed
  /// either, and this package already folds `''` into absent everywhere on the
  /// READ side (`optionalString`). Nothing is lost server-side — the route
  /// trims and nulls a blank comment regardless — so the only difference is a
  /// request body that no longer claims an answer that was never given.
  ///
  /// Throws [RestMalformedResponseException] if the response is not a
  /// `{success: true, data}` envelope carrying the stored record — never a
  /// hollow [RestCsatSubmission] a caller would render as a saved rating.
  Future<RestCsatSubmission> submitCsat(
    String sessionId, {
    required int rating,
    String? comment,
  }) async {
    final Object? body = await request(
      'POST',
      '/chat/sessions/${_segment(sessionId)}/csat',
      jsonBody: <String, Object?>{
        'rating': rating,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
      },
    );

    return RestCsatSubmission.fromJson(
      unwrapEnvelope(body, _kSubmitCsatRoute),
      _kSubmitCsatRoute,
    );
  }

  /// `GET /chat/sessions/{id}/csat` — whether THIS session already carries a
  /// rating.
  ///
  /// The read half of the same route, and the reason a customer cannot rate
  /// one conversation twice: a widget's own memory of "already rated" is state
  /// a page reload destroys, and the POST is an upsert that would happily
  /// overwrite the score.
  ///
  /// Returns [RestCsatUnrated] on a `200 {rated: false}`, which is a normal
  /// ANSWER rather than a 404 — "no rating yet" is a fact about a session the
  /// customer owns.
  ///
  /// Throws [RestMalformedResponseException] rather than reading a malformed
  /// body as unrated, on both of the route's shapes (a non-boolean `rated`, or
  /// `rated: true` with no numeric `rating`). The strictness itself lives in
  /// [RestCsatStatus.fromJson]; the reason lives here: a caller that cannot
  /// tell "not rated" from "the server said something we do not understand"
  /// offers the survey again on the exact case this route exists to prevent,
  /// while its documented answer to a FAILED lookup is to withhold it.
  Future<RestCsatStatus> getCsat(String sessionId) async {
    final Object? body = await request(
      'GET',
      '/chat/sessions/${_segment(sessionId)}/csat',
    );

    return RestCsatStatus.fromJson(
      unwrapEnvelope(body, _kGetCsatRoute),
      _kGetCsatRoute,
    );
  }

  /// `GET /chat/sessions/customer` — the authenticated customer's own recent
  /// sessions, most recent first. What a session picker renders.
  ///
  /// ── A guest's empty page is a SUCCESS ───────────────────────────────────
  ///
  /// A guest gets `200 {sessions: []}`, never a 403 or a 404 (openapi's
  /// `listSessions` operation description). Emptiness IS the guest signal, and
  /// nothing here special-cases it: a picker decides not to render itself from
  /// an ordinary empty page, and turning that into an exception would make
  /// "not identified" indistinguishable from "the lookup failed" at exactly
  /// the seam that knows they are different.
  ///
  /// ── One bad row costs one row ───────────────────────────────────────────
  ///
  /// Rows are projected individually through [projectSessionSummaryRow], which
  /// OMITS a row it cannot decode rather than throwing. Letting one
  /// forward-incompatible session — a `status` newer than this package knows —
  /// propagate out of the loop would empty the customer's whole picker.
  ///
  /// This is deliberately NOT the rule `listMessages` uses: a bad message
  /// becomes a `SYSTEM` placeholder, because a gap in a transcript is a
  /// visible lie about what was said, while a session with no status and no
  /// name is a row a customer taps and nothing happens. The two page-level
  /// projectors differ on purpose; see `session_summary_decode.dart`.
  ///
  /// ── No caching, no de-duplication, one request per call ─────────────────
  ///
  /// Every call issues its own GET. `session-list-refresh.test.ts` requires
  /// that two refreshes never overlap and that a refresh asked for mid-flight
  /// is re-issued rather than dropped — but that serialisation is the WIDGET's
  /// (`sessionsCalls` is counted around a store, not an adapter), because it
  /// depends on `pastSessions` being replaced wholesale by whoever owns that
  /// state. An adapter that coalesced here would take that decision away from
  /// the layer that can see the writes.
  ///
  /// Throws:
  ///  * [RestValidationException] if [limit] is outside
  ///    [kSessionSummaryLimitMin]..[kSessionSummaryLimitMax] — BEFORE any
  ///    request is made, so nothing was consumed and nothing was mutated;
  ///  * [RestMalformedResponseException] if the response is not a
  ///    `{success: true, data: {...}}` envelope;
  ///  * whatever [RestClient.request] throws.
  Future<List<RestChatSessionSummary>> listSessions({int? limit}) async {
    // BEFORE the request, deliberately. The route itself would 400 an
    // out-of-range value, but a caller bug — a page size where a picker size
    // belongs — should surface here rather than as a round trip's worth of
    // latency plus a generic server refusal.
    validateSessionSummaryLimit(limit);

    final Object? body = await request(
      'GET',
      '/chat/sessions/customer',
      // A null `limit` is omitted ENTIRELY by `request`, deferring to the
      // server's own default of 5 — never sent as `limit=null`.
      query: <String, Object?>{'limit': limit},
    );

    final Map<String, Object?> page = unwrapEnvelope(body, _kListSessionsRoute);

    // Defended rather than trusted, same reasoning as the history page: an
    // absent or non-list `sessions` should surface as an empty picker, not as
    // a crash deep inside a caller's state layer. The envelope was already
    // verified above, so this is the payload's own shape, not the wrapper's.
    final Object? rows = page['sessions'];
    if (rows is! List<Object?>) return <RestChatSessionSummary>[];

    final List<RestChatSessionSummary> sessions = <RestChatSessionSummary>[];
    for (final Object? row in rows) {
      final RestChatSessionSummary? summary =
          projectSessionSummaryRow(row, _kListSessionsRoute);
      if (summary != null) sessions.add(summary);
    }
    return sessions;
  }
}

/// Runs one non-idempotent mutation, then reads back the session it settled on.
///
/// Free functions rather than private members of [SessionApi] because that is
/// what the extension's public surface should be: the five methods the
/// contract names, and nothing a reader has to skip past to find them.
Future<RestChatSession> _mutateThenReadBack(
  RestClient client,
  String action,
  String sessionId,
  String route,
) async {
  final Object? body = await client.request(
    'POST',
    '/chat/sessions/${_segment(sessionId)}/$action',
  );

  // Everything from here on is AFTER the server-side effect has happened.
  final Map<String, Object?> receipt = unwrapEnvelope(body, route);

  // The receipt's own id, not the requested one — reopen may converge onto a
  // different, already-active session (`chat.routes.ts:297-308`).
  //
  // `optionalStringValue` folds `''` into absent, one notch stricter than TS's
  // `typeof receipt.sessionId === 'string'`, which would accept an empty
  // string and go on to read back `/chat/sessions//full` — a URL that
  // addresses no session at all. Falling back to the requested id on a blank
  // receipt is the only reading that can still be right.
  final String settled = optionalStringValue(receipt['sessionId']) ?? sessionId;

  return _readBackAfterMutation(client, settled);
}

/// Reads the session back, retrying the GET and ONLY the GET.
///
/// The retry surface is deliberately this one read. See [SessionApi.closeSession]
/// for why the mutation above it is never re-issued.
Future<RestChatSession> _readBackAfterMutation(
  RestClient client,
  String sessionId,
) async {
  Object? failure;

  for (int attempt = 1; attempt <= kReadBackAttempts; attempt += 1) {
    try {
      return await _readFullSession(client, sessionId);
    } catch (error) {
      // ── EVERY read-back failure is caught, not only ours ────────────────
      //
      // By the time control reaches here the mutation has already been
      // acknowledged by the server, and that fact outranks every question
      // about what went wrong afterwards. A `TokenUnavailableError` from a
      // token that expired in the window between the POST and the GET is the
      // ordinary case, not an exotic one, and letting it past unwrapped hands
      // the caller a bare auth failure with no hint that a close already
      // happened. `closeSession` is not idempotent, so a caller who reads that
      // as "it never happened" and retries re-emits a "chat closed" SYSTEM
      // message and a Kafka event.
      //
      // The original is preserved in `cause` rather than flattened, so nothing
      // is lost by wrapping it — only the misreading is prevented.
      failure = error;

      // Retry only what a retry could plausibly fix. A malformed body is
      // contract drift, not a blip: no second attempt reshapes a response.
      // Anything that is not one of our own verdicts (an auth failure, a bug)
      // is not retried either — `retryable` is the sealed base's own answer,
      // and a non-RestException has no claim to make.
      if (error is! RestException || !error.retryable) break;
    }
  }

  // Unreachable while kReadBackAttempts >= 1 — the loop either returned or
  // assigned. Asserted rather than assumed, so a future zero would fail loudly
  // here instead of silently skipping the read-back.
  assert(failure != null, 'kReadBackAttempts must be at least 1');

  throw RestSessionReadBackException(sessionId: sessionId, cause: failure!);
}

/// One `GET /chat/sessions/{id}/full`, projected.
///
/// `/full` answers `{session, messages, participants, hasMore}`; only the
/// session is read. History travels through its own paginated seam, and
/// handing a caller a second, differently-shaped copy of the same messages is
/// how the two come to disagree.
Future<RestChatSession> _readFullSession(
  RestClient client,
  String sessionId,
) async {
  final Object? body = await client.request(
    'GET',
    '/chat/sessions/${_segment(sessionId)}/full',
  );

  final Map<String, Object?> data = unwrapEnvelope(body, _kFullSessionRoute);
  return decodeRestChatSession(data['session'], _kFullSessionRoute);
}

/// Percent-encodes a session id into a single path segment.
///
/// `Uri.parse` does not escape what it is handed, so an id containing a `/`
/// would otherwise split into two segments and address a different route
/// entirely — `/chat/sessions/a/b/csat` is not `/chat/sessions/{a%2Fb}/csat`.
/// Mirrors every `encodeURIComponent` call in `adapters.ts`; the two escape
/// the same set, leaving only `A-Za-z0-9-_.!~*'()` untouched.
String _segment(String sessionId) => Uri.encodeComponent(sessionId);
