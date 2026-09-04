/// The two things the header can ask the server to do, as seams — plus the
/// REST-backed implementations of both.
///
/// Ports `widget.ts`'s `emailTranscript` (:3651-3669) and `fileIssueReport`
/// (:3700-3712). Neither route has a REST adapter in `@dhaam-ccrm/rest` and
/// neither appears in `openapi/chat-api.yaml`; those two call sites are the
/// only authority, and `dhaam_chat_rest`'s `SupportApi` is where the requests
/// themselves live.
///
/// ── Why the widgets take functions and not a `RestClient` ────────────────
///
/// Same rule the attachment module states for `AttachmentUploader`: a widget
/// that constructs its own network client is a widget whose tests need a
/// network. `ReportIssueForm` takes an [IssueReporter] and the transcript
/// button takes a [TranscriptEmailer], so every test in this module supplies
/// a closure. [restIssueReporter] and [restTranscriptEmailer] are the real
/// implementations, and this file is the only one in the module that imports
/// the REST package.
library;

import 'package:dhaam_chat_rest/dhaam_chat_rest.dart';

export 'package:dhaam_chat_rest/dhaam_chat_rest.dart' show RestIssueReport;

/// Emails the customer their own conversation. Rejects on failure.
///
/// Rejects rather than reporting, because the caller is a button that has to
/// change its own label on failure — a reporter would swallow the outcome and
/// leave it reading "Sending…" forever.
typedef TranscriptEmailer = Future<void> Function();

/// Files an issue report. Rejects on failure.
///
/// Rejects for the same reason, plus one more: `FormSubmitController`'s whole
/// contract is that a rejected submit re-enables the form and keeps what the
/// customer typed. A reporter would let the form advance to a confirmation
/// for a report that was never filed.
typedef IssueReporter = Future<void> Function(RestIssueReport report);

/// Which session the header is acting on, resolved at the moment of the
/// action rather than captured when the button was built.
///
/// The reference reads `store.getState().session?.id ?? closedSessionId` at
/// call time for a concrete reason: the transcript button only exists on a
/// CLOSED conversation, so the live session is already gone by the time it is
/// pressed and the id has to come from whatever the widget remembered. A
/// captured value would be the id of whichever session happened to be current
/// when the header was built.
///
/// Returns null when there is no conversation at all.
typedef SessionIdSource = String? Function();

/// The real transcript email, over [SupportApi.emailTranscript].
///
/// The guard is the point. `POST /chat/sessions/{id}/transcript/email` with
/// no id is a request to a path that names no session, and the reference's own
/// comment says what it was avoiding:
/// `/sessions/undefined/transcript/email`. Refused here, before the client is
/// even asked — and refused again inside `SupportApi`, which is not
/// redundancy: this one produces the sentence a customer sees, that one is the
/// package-level invariant that holds for every other caller too.
TranscriptEmailer restTranscriptEmailer({
  required RestClient client,
  required SessionIdSource sessionId,
}) {
  return () async {
    final String? id = sessionId();
    if (id == null || id.trim().isEmpty) {
      throw StateError('No conversation to send');
    }
    await client.emailTranscript(id);
  };
}

/// The real issue report, over [SupportApi.reportIssue].
IssueReporter restIssueReporter({
  required RestClient client,
  required SessionIdSource sessionId,
}) {
  return (RestIssueReport report) async {
    final String? id = sessionId();
    if (id == null || id.trim().isEmpty) {
      throw StateError('No conversation to report against');
    }
    await client.reportIssue(id, report);
  };
}
