/// The name to put on one message, and the name of whoever holds the
/// session. Ports `ui/message-list.ts`'s `senderLabel`, `handlerName` and
/// `botNameFrom`.
///
/// Every name here comes from [SessionSnapshot], because that is the only
/// place a name exists: [ChatMessage] carries `senderId` and no display name
/// at all, so a bubble cannot name its own author.
///
/// ── The BOT branch used to be a hardcoded string ─────────────────────────
///
/// It returned the literal "Assistant" for every deployment, throwing away
/// the per-tenant bot name the backend resolves and sends
/// (`Tenant.config.botDisplayName` → `resolveBotDisplayName` →
/// `SessionSnapshot.handledBy`). A tenant who names their bot "Kai" got
/// "Assistant" on every bubble regardless.
///
/// ── Why the bot's name has to be REMEMBERED ──────────────────────────────
///
/// The bot's name is only on the wire while the BOT still holds the session.
/// Once it escalates to a human, `handledBy` names the AGENT, and the bot's
/// earlier messages — still in the transcript, right above the agent's —
/// would fall back to the generic word. [BotNameMemory] keeps it per
/// session, and drops it the moment `session.id` changes so one
/// conversation's bot name can never be printed over another's messages.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show
        ChatMessage,
        HandledByKind,
        ParticipantSnapshot,
        ParticipantType,
        SenderType,
        SessionSnapshot;

/// The bot's name for one session, remembered across the escalation that
/// takes it off the wire.
///
/// Mutable and deliberately so: it is the one piece of history the
/// transcript's otherwise-pure projection needs, and folding it into
/// `MessageListPresenter` alone would make it untestable without building a
/// whole render.
class BotNameMemory {
  String? _name;
  String? _sessionId;

  /// The name currently remembered, or `null`.
  String? get name => _name;

  /// Feeds one state tick in and returns the name to use for BOT bubbles.
  ///
  /// Clears the memory whenever the session id changes — including to and
  /// from `null` — because a name learned in one conversation is not a fact
  /// about another.
  String? observe(SessionSnapshot? session) {
    final String? sessionId = session?.sessionId;
    if (sessionId != _sessionId) {
      _sessionId = sessionId;
      _name = null;
    }
    _name = botNameFrom(session) ?? _name;
    return _name;
  }
}

/// The bot's name as this session currently reports it, or `null`.
String? botNameFrom(SessionSnapshot? session) {
  final HandledByKind? kind = session?.handledBy?.kind;
  return kind == HandledByKind.bot ? session?.handledBy?.displayName : null;
}

/// The agent currently on the session, from the participant roster.
///
/// `dhaam_chat`'s [SessionSnapshot] has no `assignedAgent` field — the TS
/// `ChatSession` does — so the roster is where that fact lives here. A
/// participant row's `displayName` is optional (a membership record that
/// sometimes carries a name), which is why a nameless AGENT row is skipped
/// rather than rendered as an empty heading.
String? assignedAgentName(SessionSnapshot? session) {
  if (session == null) return null;
  for (final ParticipantSnapshot participant in session.participants) {
    if (participant.type != ParticipantType.agent) continue;
    final String? name = participant.displayName;
    if (name != null) return name;
  }
  return null;
}

/// The name to put on one message.
///
/// AGENT prefers the roster and falls back to a `handledBy` that names an
/// agent: on a session the customer has just joined from history,
/// `participants` may be empty (everyone has left) while `handledBy` still
/// names who had it.
String senderLabel(
  ChatMessage message,
  SessionSnapshot? session,
  String? lastBotName,
) {
  final HandledByKind? handledKind = session?.handledBy?.kind;
  final String? handledName = session?.handledBy?.displayName;

  return switch (message.senderType) {
    SenderType.agent => assignedAgentName(session) ??
        (handledKind == HandledByKind.agent ? handledName : null) ??
        'Agent',
    SenderType.system => 'System',
    SenderType.bot => handledKind == HandledByKind.bot
        ? handledName ?? 'Assistant'
        : lastBotName ?? 'Assistant',
    SenderType.customer => 'You',
  };
}

/// The name of whoever is handling the conversation right now — an agent if
/// one is on it, otherwise the bot, falling back to the generic word only
/// when neither has a resolved name.
///
/// Same sources as [senderLabel], kept separate because this answers "who
/// holds the session" (for the typing indicator) rather than "who wrote this
/// message" (for a bubble), and a transcript can contain both. The typing
/// label used to be the fixed word "Agent", which named a human on a session
/// being handled by the bot.
String handlerName(SessionSnapshot? session, String? lastBotName) {
  final String? handledName = session?.handledBy?.displayName;
  if (handledName != null) return handledName;
  return assignedAgentName(session) ?? lastBotName ?? 'Agent';
}

/// Whether this message is the customer's own.
///
/// The alignment, the colour and the "never announce our own" rule all read
/// this one predicate, so a bubble cannot be drawn as theirs and announced
/// as someone else's.
bool isOutgoing(ChatMessage message) =>
    message.senderType == SenderType.customer;
