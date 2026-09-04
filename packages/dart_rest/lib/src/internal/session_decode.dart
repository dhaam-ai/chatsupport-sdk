/// Raw Prisma session rows → [RestChatSession].
///
/// The session-shaped sibling of `message_decode.dart`, and for the same
/// reason: `GET /chat/sessions/{id}/full` returns a raw row — integer
/// `status`/`mode`, a bare `ticketId`, enrichment blocks with no ids in them —
/// while everything downstream expects the projected shape the socket emits.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMode, ChatStatus;

import '../models/session.dart';
import 'json_reading.dart';

/// `ChatStatus` — enums.ts:15-22. All SIX backend values.
///
/// v1's type system modelled four and collapsed the other two into `OPEN`,
/// which is how `RESOLVED` and `ON_HOLD` silently disappeared for years
/// (§12.1). Removing a value here would reintroduce that bug in Dart.
const Map<int, ChatStatus> _chatStatusByInt = <int, ChatStatus>{
  1: ChatStatus.open,
  2: ChatStatus.waitingForAgent,
  3: ChatStatus.assigned,
  4: ChatStatus.closed,
  5: ChatStatus.resolved,
  6: ChatStatus.onHold,
};

/// `ChatMode` — enums.ts:24-27.
const Map<int, ChatMode> _chatModeByInt = <int, ChatMode>{
  1: ChatMode.bot,
  2: ChatMode.human,
};

/// The `session` object from `GET /chat/sessions/{id}/full` → the projected
/// shape.
///
/// Integer `status` and `mode` are decoded the same way message enums are, and
/// refused the same way when unmapped — unlike [decodeParticipantProfile]
/// below, whose failure is additive and therefore silent. The difference is
/// deliberate: a session with the wrong status renders a wrong control (a
/// closed session offering a composer, an open one offering a survey), while a
/// session with no agent nameplate renders one fewer label.
RestChatSession decodeRestChatSession(Object? row, String context) {
  final Map<String, Object?> source =
      requireObject(row, 'a session row', context: context);

  final String? ticketId = optionalString(source, 'ticketId');

  return RestChatSession(
    id: requireNonEmptyString(source, 'id', 'session', context: context),
    status: requireIntEnum(
      _chatStatusByInt,
      source,
      'status',
      'session',
      context: context,
    ),
    mode: requireIntEnum(
      _chatModeByInt,
      source,
      'mode',
      'session',
      context: context,
    ),
    createdAt:
        requireTimestamp(source, 'createdAt', 'session', context: context),
    // Absent while the session is still open — not an error.
    closedAt: optionalTimestamp(source, 'closedAt'),
    assignedAgent: decodeParticipantProfile(
      source['assignedAgent'],
      source['assignedAgentId'],
    ),
    customer: decodeParticipantProfile(
      source['customer'],
      source['customerId'],
    ),
    ticket: ticketId == null ? null : RestChatTicket(id: ticketId),
  );
}

/// An enriched user block plus the outer row's id → a profile, or `null`.
///
/// Never throws. Both of its `null` returns are documented states rather than
/// failures: `chat-user.service` swallows its own enrichment failure and
/// leaves the block null, and a session with no assigned agent has no
/// `assignedAgentId` to begin with.
RestChatParticipantProfile? decodeParticipantProfile(
  Object? block,
  Object? participantId,
) {
  // No id means no profile. A nameplate that cannot be correlated to a
  // presence update or a read watermark is worse than no nameplate: it renders
  // a person who then never appears to come online.
  final String? id = optionalStringValue(participantId);
  if (id == null) return null;
  if (block is! Map<String, Object?>) return null;

  return RestChatParticipantProfile(
    participantId: id,
    displayName: optionalStringValue(block['displayName']) ?? id,
    // NOT read from the block, even though `/full` returns a real address in
    // it. See RestChatParticipantProfile.email for the full reasoning — the
    // short version is that nothing renders it, and the widget runs inside
    // third-party pages whose session-replay tools serialize state wholesale.
    email: null,
    avatarUrl: optionalStringValue(block['avatarUrl']),
  );
}
