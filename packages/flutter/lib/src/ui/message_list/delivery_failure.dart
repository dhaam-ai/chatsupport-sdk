/// Why a send failed, and what the transcript says about it. Ports
/// `state/types.ts`'s `SendFailureReason` and `ui/message-list.ts`'s
/// `FAILURE_REASON_COPY`.
///
/// ── Why this lives here and not in `dhaam_chat` ──────────────────────────
///
/// `dhaam_chat`'s `MessageDelivery` is a four-value enum — `pending`,
/// `confirmed`, `queued`, `failed` — with no reason and no `retryable`,
/// because the durable offline queue that produces the other reasons is not
/// in that package yet (see [MessageDelivery.failed]'s own doc). The widget
/// nonetheless has to render a distinct sentence per reason and offer Retry
/// only where retrying is honest, so [SendFailure] is the shape the caller
/// hands down until core carries it.
///
/// The important consequence is a good one: this module CANNOT re-derive
/// [SendFailure.retryable], because it never sees the code or the transport
/// that would let it. `retry.hidden = !delivery.retryable` is enforced by
/// the type, not by discipline.
library;

/// Why a queued send will never be retried again — `state/types.ts`'s own
/// union, value for value.
enum SendFailureReason {
  /// The server refused it. A retry would be refused identically (§7.4).
  rejected,

  /// The session it was queued against ended before it reached the wire
  /// (§12.5's terminal `CloseReason`s).
  ///
  /// Distinct from [rejected] precisely because a retry is not futile: this
  /// send was refused by US, locally, and the same content sent into a new
  /// session would go through.
  sessionClosed,

  /// It outlived the queue's configured max age (§9.6).
  expired,

  /// Pruned to bring the queue under its configured max entries (§9.6).
  evicted,

  /// The durable write did not land and is not recoverable (§9.1).
  storage,
}

/// One message's failure, as core reported it.
///
/// Constructed by whoever owns the queue and handed to the transcript.
/// Nothing here is computed from anything else.
class SendFailure {
  const SendFailure({
    required this.reason,
    required this.retryable,
    this.code,
  });

  final SendFailureReason reason;

  /// Whether retrying this exact send is worth attempting.
  ///
  /// Mirrors the server's `ErrorPayload.retryable` one for one when the queue
  /// had it to report — the server already computes this once per code
  /// (§7.4), so nothing re-derives it from a second, hand-maintained copy of
  /// that table. Always present, even when it was defaulted, precisely so a
  /// renderer never has to ask "was this reported, or defaulted?": it has one
  /// boolean to branch on.
  final bool retryable;

  /// The server's §7.4 code, present only when this failure came from a
  /// rejected `message.send`. Never read to decide anything — it is here so
  /// a host's error sink can log something diagnosable.
  final String? code;

  @override
  bool operator ==(Object other) =>
      other is SendFailure &&
      other.reason == reason &&
      other.retryable == retryable &&
      other.code == code;

  @override
  int get hashCode => Object.hash(reason, retryable, code);

  @override
  String toString() =>
      'SendFailure(${reason.name}, retryable: $retryable, code: $code)';
}

/// What a failed send says, per [SendFailureReason].
///
/// Shown on EVERY failure, whether or not a Retry button accompanies it: a
/// permanently-refused send still owes the customer a reason. A `switch`
/// expression with no default clause, so a reason core adds that this list
/// has not been taught to describe is a COMPILE ERROR rather than a bubble
/// that silently says nothing.
String failureReasonCopy(SendFailureReason reason) {
  return switch (reason) {
    SendFailureReason.rejected => 'This message could not be sent.',
    SendFailureReason.sessionClosed =>
      'This conversation ended before this message could send.',
    SendFailureReason.expired => 'This message took too long to send.',
    SendFailureReason.evicted => 'Too many messages were waiting to send.',
    SendFailureReason.storage =>
      'This message could not be saved on this device.',
  };
}
