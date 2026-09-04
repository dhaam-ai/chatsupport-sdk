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
import 'models/session_summary.dart';

/// Route names, exactly as they reach a [RestMalformedResponseException].
///
/// Constants rather than strings built at each throw site: the `context` on a
/// malformed-response failure must be a caller-side literal with no request or
/// response content in it, and a route name that is never interpolated is how
/// that stays true by construction rather than by review.
const String _kListSessionsRoute = 'GET /chat/sessions/customer';

/// The session and CSAT surface of chat-service, on [RestClient].
///
/// In scope for anything that imports `package:dhaam_chat_rest/dhaam_chat_rest.dart`
/// — the barrel re-exports this extension by name, and `test/barrel_test.dart`
/// asserts that the re-export actually carries it, because "a named extension
/// survives an `export`" is a language property worth pinning rather than
/// assuming.
extension SessionApi on RestClient {
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
