/// The two routes the customer reaches from the conversation header:
/// emailing themselves the transcript, and filing an issue report.
///
/// ── `widget.ts` is the only authority for both ────────────────────────────
///
/// Neither route is modelled in `@dhaam-ccrm/rest` and neither appears in
/// `openapi/chat-api.yaml`. The widget issues both raw:
///
///   * `POST /chat/sessions/{id}/transcript/email` — `widget.ts:3669`
///   * `POST /chat/sessions/{id}/report-issue`     — `widget.ts:3712`
///
/// So there is no adapter to mirror and no spec to chase. These two methods
/// are ported from those call sites and nothing else, which is why they live
/// in their own file rather than beside the session routes that DO have an
/// adapter behind them.
///
/// ── Why an extension, and why here ────────────────────────────────────────
///
/// Same shape and same reasoning as `SessionApi` and `MediaApi`: `client.dart`
/// owns the base path, the two credentials and the failure taxonomy, and every
/// route this package speaks is built on the one primitive it exposes,
/// [RestClient.request]. An `extension` reaches the `client.reportIssue(...)`
/// call shape without that file growing an endpoint list.
library;

import 'client.dart';
import 'errors.dart';
import 'models/issue_report.dart';

/// The two support routes, on [RestClient].
extension SupportApi on RestClient {
  /// `POST /chat/sessions/{id}/transcript/email`.
  ///
  /// ── The request carries NO body, and that is the security model ─────────
  ///
  /// The recipient is resolved server-side from the session's own record and
  /// is never accepted from a client. An address the caller could choose
  /// would make this a way to mail any conversation anywhere. `widget.ts`
  /// sends `body: {}` for the same reason; here the body is omitted outright,
  /// which is the same request on the wire minus two bytes and one
  /// `Content-Type` that describes nothing.
  ///
  /// ── The guard is not defensive programming ─────────────────────────────
  ///
  /// A blank [sessionId] must never become
  /// `/chat/sessions//transcript/email`, and the reference's own comment
  /// names the shape it was avoiding: `/sessions/undefined/transcript/email`.
  /// In Dart the null case is a compile error, so what is left to refuse is
  /// the empty string — checked BEFORE the request, so nothing is consumed
  /// and a caller bug surfaces as a caller bug rather than as a 404 from a
  /// path that means nothing.
  ///
  /// Throws:
  ///  * [RestValidationException] for a blank [sessionId], before any
  ///    request;
  ///  * whatever [RestClient.request] throws.
  ///
  /// Deliberately rejects rather than reporting: the caller is a button that
  /// has to change its own label on failure, and swallowing the outcome
  /// leaves it reading "Sending…" forever.
  Future<void> emailTranscript(String sessionId) async {
    _requireSessionId(sessionId, 'emailTranscript');
    await request(
      'POST',
      '/chat/sessions/${Uri.encodeComponent(sessionId)}/transcript/email',
    );
  }

  /// `POST /chat/sessions/{id}/report-issue`.
  ///
  /// The body carries neither a tenant nor a session id: the tenant comes
  /// from the verified token and the session is in the path, which is the
  /// rule the route states in its own header. Sending either is rejected with
  /// a 400 that says so — see [RestIssueReport], which has no field for
  /// either.
  ///
  /// [RestIssueReport.contactEmail] is omitted from the body when null. A
  /// caller holding an empty text field must pass null, not `''`: the route
  /// runs its own `.email()` check on the field, and an empty string fails it
  /// for no reason at all — a customer who simply chose not to leave an
  /// address would have their whole report rejected.
  ///
  /// Nothing is returned. The route reports no ticket reference, and
  /// inventing one for a confirmation to quote is the kind of small
  /// dishonesty this package avoids.
  ///
  /// Throws:
  ///  * [RestValidationException] for a blank [sessionId], before any
  ///    request;
  ///  * whatever [RestClient.request] throws.
  Future<void> reportIssue(String sessionId, RestIssueReport report) async {
    _requireSessionId(sessionId, 'reportIssue');
    await request(
      'POST',
      '/chat/sessions/${Uri.encodeComponent(sessionId)}/report-issue',
      jsonBody: report.toJson(),
    );
  }
}

/// Refuses a session id that would build a path pointing at no session.
///
/// [RestValidationException] rather than an [ArgumentError] so it lands in the
/// same taxonomy every other refusal in this package does — and because the
/// fact worth encoding is the one that type exists for: no network activity
/// happened, so nothing was consumed and nothing was mutated.
void _requireSessionId(String sessionId, String method) {
  if (sessionId.trim().isEmpty) {
    // The value is not echoed, per this package's rule that error text never
    // carries input.
    throw RestValidationException('$method requires a non-empty sessionId');
  }
}
