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
import 'internal/envelope.dart';
import 'internal/limits.dart';
import 'internal/session_summary_decode.dart';
import 'models/csat.dart';
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

/// The session and CSAT surface of chat-service, on [RestClient].
///
/// In scope for anything that imports `package:dhaam_chat_rest/dhaam_chat_rest.dart`
/// — the barrel re-exports this extension by name, and `test/barrel_test.dart`
/// asserts that the re-export actually carries it, because "a named extension
/// survives an `export`" is a language property worth pinning rather than
/// assuming.
extension SessionApi on RestClient {
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

/// Percent-encodes a session id into a single path segment.
///
/// `Uri.parse` does not escape what it is handed, so an id containing a `/`
/// would otherwise split into two segments and address a different route
/// entirely — `/chat/sessions/a/b/csat` is not `/chat/sessions/{a%2Fb}/csat`.
/// Mirrors every `encodeURIComponent` call in `adapters.ts`; the two escape
/// the same set, leaving only `A-Za-z0-9-_.!~*'()` untouched.
String _segment(String sessionId) => Uri.encodeComponent(sessionId);
