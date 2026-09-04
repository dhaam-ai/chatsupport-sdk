/// What a failed send says to the customer. Ports `ui/message-list.ts`'s
/// `FAILURE_REASON_COPY`.
///
/// ── Why the reason itself is not defined here ────────────────────────────
///
/// It used to be. `dhaam_chat`'s `MessageDelivery` was a four-value enum
/// recording THAT a send failed and never why, so this module carried its own
/// `SendFailureReason` and a `SendFailure` record that a caller had to supply
/// from outside — and no caller ever could, because the fact it needed was
/// computed inside `ChatClient` and never escaped a private map.
///
/// `MessageDelivery` is now a union and `MessageFailed` carries the reason,
/// the server's §7.4 code and its `retryable` verdict, so the parallel
/// hierarchy is gone: there is one `SendFailureReason`, in the package that
/// can construct one. This file keeps the only half that was ever the
/// widget's business — the sentence.
///
/// The consequence worth naming: `retryable` still cannot be re-derived
/// here, and now for a stronger reason than before. It is not merely absent
/// from this module's inputs; it is a field on the message, decided once by
/// whoever failed the send. `MessageRow.showRetry` reads it and nothing else.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show SendFailureReason;

/// What a failed send says, per [SendFailureReason].
///
/// Shown on EVERY failure, whether or not a Retry button accompanies it: a
/// permanently-refused send still owes the customer a reason. A `switch`
/// expression with no default clause, so a reason core adds that this list
/// has not been taught to describe is a COMPILE ERROR rather than a bubble
/// that silently says nothing.
///
/// Two sentences, because `SendFailureReason` has two values. It had five
/// here once — one each for `expired`, `evicted` and `storage` — written,
/// reviewed and reachable by nothing, because the durable queue that
/// produces those reasons does not exist. They come back in the change that
/// can first make one of them happen.
String failureReasonCopy(SendFailureReason reason) {
  return switch (reason) {
    SendFailureReason.rejected => 'This message could not be sent.',
    SendFailureReason.sessionClosed =>
      'This conversation ended before this message could send.',
  };
}
