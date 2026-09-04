/// The ONE derivation of a message's delivery tick. Ports
/// `packages/core/src/messages/ticks.ts`.
///
/// ── The bug this replaces ────────────────────────────────────────────────
///
/// v1 drew the double-grey tick from PRESENCE — "the other party is
/// connected". Connectivity is not delivery: a participant can be connected
/// and not yet caught up (the frames are still in flight, or they
/// reconnected and their replay has not been applied), and can be
/// disconnected having received everything. A double tick drawn from
/// connectivity is a claim about a socket, not about a message.
///
/// [TickInput] is deliberately the whole of what this function can see.
/// There is no field on it for presence, for agent liveness, or for the
/// connection state, so the mistake cannot be made here again — and no other
/// file in this module computes a tick, so there is one implementation, one
/// set of edge cases, and one thing to assert.
///
/// ── Mapping `dhaam_chat`'s four delivery states onto core's two ──────────
///
/// `state/types.ts`'s `MessageDelivery` is a union of `queued` and `failed`
/// with "absent means server-confirmed"; `dhaam_chat` splits the confirmed
/// case in two, giving `pending` (sent optimistically, no ack, `seq` null)
/// alongside `confirmed`. Core's optimistic echo is itself recorded as
/// `{state: 'queued'}` (messages/controller.ts), so [MessageDelivery.pending]
/// and [MessageDelivery.queued] BOTH correspond to core's `queued` and both
/// yield [MessageTickState.pending] here. They differ in where the message is
/// — a socket's write buffer versus this client's outbox — and not in
/// anything the customer can act on, which is the same call
/// `conversation_screen.dart`'s own delivery glyph already made.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show ChatMessage, MessageDelivery, ParticipantSnapshot, SessionSnapshot;

/// The four tick states, weakest to strongest.
enum MessageTickState { pending, sent, delivered, read }

/// Everything [deriveTickState] reads, and nothing else.
class TickInput {
  const TickInput({
    required this.message,
    required this.localParticipantId,
    this.deliveredWatermarks = const <String, int>{},
    this.readWatermarks = const <String, DateTime>{},
  });

  final ChatMessage message;

  /// Who "we" are. Ticks describe our own outgoing messages, and both the
  /// `delivered` and `read` rules turn on SOME OTHER participant — so
  /// without this id there is no way to tell our own watermark from someone
  /// else's, and our own would satisfy every rule the instant we reported it.
  ///
  /// `null` (identity not yet known) yields `null` for every message: a
  /// conservative no-tick, never a guessed one. Notably this does NOT fall
  /// back to "sender type is CUSTOMER" — that heuristic is fine for counting
  /// unread messages, where being wrong costs a badge, but here it would make
  /// an agent-side embed show ticks on the customer's messages.
  final String? localParticipantId;

  /// participantId → highest `seq` held.
  final Map<String, int> deliveredWatermarks;

  /// participantId → the instant that participant has read up to,
  /// inclusive. `ParticipantSnapshot.lastReadAt`'s own key.
  final Map<String, DateTime> readWatermarks;
}

/// The tick to render for one message, or `null` for no tick at all.
///
/// The four states and their conditions, evaluated strongest-first so a
/// message that satisfies several reports the furthest it has got:
///
/// | State       | Condition                                                 |
/// |-------------|-----------------------------------------------------------|
/// | `read`      | some other participant's read watermark covers `createdAt` |
/// | `delivered` | some other participant's delivered `seq` >= this `seq`     |
/// | `sent`      | has `seq`, and no other watermark reaches it               |
/// | `pending`   | not yet acked                                              |
///
/// `pending` is tested first rather than last, because an unacked message has
/// no `seq` at all and so cannot satisfy any other row; testing it first is
/// what lets the remaining three assume a `seq` exists.
///
/// `null` is returned in four cases, all deliberate:
///
///  1. The message is not ours. §6.4 has no tick concept for someone else's
///     message — their client renders that.
///  2. [TickInput.localParticipantId] is `null`. See its doc.
///  3. The delivery state is [MessageDelivery.failed]. The table has no row
///     for it and a tick is the wrong affordance: a failure reason plus a
///     retry button is what that state needs. `pending`'s clock or `sent`'s
///     single tick would both claim something untrue about a message that
///     will never arrive.
///  4. The message has no `seq` and is confirmed — reachable when the server
///     acks a send without one. With no ordering key no watermark can ever
///     cover it, so there is no honest tick to show; `sent`'s row requires a
///     `seq` and this deliberately does not widen it.
///
/// Read state is compared on `createdAt` and delivery on `seq` — not an
/// inconsistency but the two watermarks' actual keys (§9.5 fixed read
/// watermarks as `lastReadAt` instants; delivery is `seq` per D2, because
/// `deliveredAt` from another participant's clock is not comparable to
/// anything).
MessageTickState? deriveTickState(TickInput input) {
  final String? local = input.localParticipantId;
  if (local == null) return null;

  final ChatMessage message = input.message;
  if (message.senderId != local) return null;

  switch (message.delivery) {
    case MessageDelivery.failed:
      return null;
    case MessageDelivery.pending:
    case MessageDelivery.queued:
      return MessageTickState.pending;
    case MessageDelivery.confirmed:
      break;
  }

  final int? seq = message.seq;
  if (seq == null) return null;

  if (_hasOtherRead(input, local, message.createdAt)) {
    return MessageTickState.read;
  }
  if (_hasOtherDelivered(input, local, seq)) {
    return MessageTickState.delivered;
  }
  return MessageTickState.sent;
}

/// Whether any participant other than us holds [seq].
///
/// "Other than us" is load-bearing, not defensive: a client advances its own
/// delivery watermark the moment it acknowledges receipt, so counting it
/// would tick every one of our own messages `delivered` against nothing but
/// our own receipt.
bool _hasOtherDelivered(TickInput input, String local, int seq) {
  for (final MapEntry<String, int> entry in input.deliveredWatermarks.entries) {
    if (entry.key == local) continue;
    if (entry.value >= seq) return true;
  }
  return false;
}

/// Whether any participant other than us has read past [createdAt].
///
/// Inclusive, matching the watermark's own meaning — "read up to and
/// including this instant". Compared as instants rather than as strings,
/// because an ISO-8601 string with a `+hh:mm` offset can sort differently as
/// text than as a moment in time.
bool _hasOtherRead(TickInput input, String local, DateTime createdAt) {
  for (final MapEntry<String, DateTime> entry in input.readWatermarks.entries) {
    if (entry.key == local) continue;
    if (!entry.value.isBefore(createdAt)) return true;
  }
  return false;
}

/// A tick's glyph and the phrase a screen reader gets. The phrase is not
/// optional: WCAG 1.4.1 forbids colour alone being the difference between
/// "delivered" and "read", so every tick carries the word.
class TickPresentation {
  const TickPresentation(this.glyph, this.label);

  final String glyph;
  final String label;
}

/// The glyph and words for one tick state. Exhaustive by construction — a
/// fifth state would be a compile error here rather than a blank tick.
TickPresentation tickPresentation(MessageTickState tick) {
  return switch (tick) {
    MessageTickState.pending => const TickPresentation('○', 'Sending'),
    MessageTickState.sent => const TickPresentation('✓', 'Sent'),
    MessageTickState.delivered => const TickPresentation('✓✓', 'Delivered'),
    MessageTickState.read => const TickPresentation('✓✓', 'Read'),
  };
}

/// The read watermarks a session snapshot already carries.
///
/// A projection, not a derivation: `ParticipantSnapshot.lastReadAt` IS the
/// §9.5 read watermark, so reading it here computes nothing — it renames a
/// field into the map [TickInput] wants. Participants who have read nothing
/// yet are absent from the result rather than present at the epoch, which is
/// the distinction that field's own doc draws.
///
/// There is no counterpart for delivered watermarks: `dhaam_chat` decodes
/// `message.delivered` and deliberately drops it (see `client.dart`), so
/// nothing in this package knows another participant's highest held `seq`
/// and no honest `delivered` tick can be drawn until it does.
Map<String, DateTime> readWatermarksFrom(SessionSnapshot? session) {
  if (session == null) return const <String, DateTime>{};
  final Map<String, DateTime> watermarks = <String, DateTime>{};
  for (final ParticipantSnapshot participant in session.participants) {
    final DateTime? lastReadAt = participant.lastReadAt;
    if (lastReadAt != null) {
      watermarks[participant.participantId] = lastReadAt;
    }
  }
  return watermarks;
}
