/// The session shape `GET /chat/sessions/{sessionId}/full` returns.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMode, ChatStatus;

import '../internal/session_decode.dart';

/// `GET /chat/sessions/{sessionId}/full`'s `session` object.
///
/// ── Why this is a new type and not `dhaam_chat`'s `SessionSnapshot` ───────
///
/// Both describe "a session", and the two shapes genuinely differ.
/// `SessionSnapshot` carries a generic `participants` list (its `HandledBy` is
/// a separate field) and has no `closedAt` at all — on the socket, closure
/// arrives as its own `session.closed` push and is never embedded in a
/// snapshot. `/full` carries named [assignedAgent]/[customer] fields, a
/// [closedAt], and a [ticket] object `SessionSnapshot` has nowhere to put.
///
/// Reusing `SessionSnapshot` would mean either losing fields or reaching into
/// a type `dhaam_chat` owns to add ones it deliberately does not model. This
/// is the same call `projection.ts` makes for its own `RestChatSession`
/// against core's `ChatSession`.
///
/// [status] and [mode] DO reuse `dhaam_chat`'s [ChatStatus]/[ChatMode]: the
/// leaf vocabulary is identical to the socket's, only the containing shape
/// differs. Splitting those into parallel enums would buy a translation layer
/// and nothing else.
class RestChatSession {
  const RestChatSession({
    required this.id,
    required this.status,
    required this.mode,
    required this.createdAt,
    required this.closedAt,
    required this.assignedAgent,
    required this.customer,
    required this.ticket,
  });

  /// Decodes `data.session` from a `GET …/full` envelope.
  ///
  /// Throws `RestMalformedResponseException` on an unmappable `status`/`mode`
  /// — refusing to guess for the same reason `dhaam_chat`'s own `requireEnum`
  /// refuses: an unmapped integer means this package is behind the service,
  /// not something a fallback can paper over.
  factory RestChatSession.fromJson(
    Map<String, Object?> json,
    String context,
  ) =>
      decodeRestChatSession(json, context);

  final String id;
  final ChatStatus status;
  final ChatMode mode;
  final DateTime createdAt;

  /// `null` while the session is still open — absent here is a documented
  /// answer, not a parse failure.
  final DateTime? closedAt;

  final RestChatParticipantProfile? assignedAgent;
  final RestChatParticipantProfile? customer;
  final RestChatTicket? ticket;
}

/// A participant profile as `/full` enriches it.
///
/// NOT `dhaam_chat`'s `ParticipantSnapshot`: that shape carries
/// `type`/`lastReadAt` and lacks `email`/`avatarUrl`, and this one is the
/// inverse. Two genuinely different "participant" concepts that happen to
/// share an English name, same as [RestChatSession] above.
class RestChatParticipantProfile {
  const RestChatParticipantProfile({
    required this.participantId,
    required this.displayName,
    required this.email,
    required this.avatarUrl,
  });

  /// Builds a profile from an enriched user block plus the id from the OUTER
  /// row.
  ///
  /// `enrichSessionWithUsers` attaches `{displayName, email, avatarUrl,
  /// isOnline}` and NO id, but a participant id is what a presence update and
  /// a read watermark are both keyed by. The id therefore comes from the outer
  /// row's `assignedAgentId`/`customerId` — which is where the enrichment read
  /// it from in the first place.
  ///
  /// No id means no profile: returns `null` rather than a nameplate nothing
  /// can correlate presence against.
  static RestChatParticipantProfile? fromEnrichedBlock(
    Object? block,
    Object? participantId,
  ) =>
      decodeParticipantProfile(block, participantId);

  final String participantId;

  /// Falls back to [participantId] when the enrichment resolved no name —
  /// matching `toProfile`'s own fallback. An id is a poor label but it is a
  /// stable one, and it is better than a blank nameplate.
  final String displayName;

  /// ALWAYS `null` from the decode path, even though `/full` DOES return a
  /// real address here.
  ///
  /// ── Deliberate, and not a gap ─────────────────────────────────────────
  ///
  /// The WebSocket path never carries an email either, nothing in any binding
  /// renders this field, and the widget this SDK serves runs inside
  /// third-party pages whose session-replay and error-reporting tools
  /// serialize application state wholesale. Populating it would put a real
  /// customer email into a store built for someone else's page to record, in
  /// exchange for zero feature.
  ///
  /// A consumer that genuinely needs the address should read it from its own
  /// backend, where it is already authorized to. Mirrors `toProfile`'s
  /// identical choice in `projection.ts` verbatim, comment included, because
  /// the reasoning is not TypeScript-specific.
  ///
  /// The field is kept rather than deleted so the shape still matches the
  /// route's documented response, and so this comment has somewhere to live.
  final String? email;

  final String? avatarUrl;
}

/// `/full`'s bare `ticketId`, promoted to an object.
///
/// The row carries a `string | null`; a `{id, url}` object is the shape the
/// rest of this SDK uses for a ticket, so the promotion happens here rather
/// than in every caller.
class RestChatTicket {
  const RestChatTicket({required this.id, this.url});

  final String id;

  /// Always `null` today — there is no ticket URL on this service to fill in
  /// yet. Modelled anyway because the field is part of the shape callers
  /// already expect, and a caller that renders a link when one exists needs
  /// somewhere for it to appear when it does.
  final String? url;
}
