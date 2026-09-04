/// The bot's own suggested follow-ups — `metadata.options` on a message.
/// Ports `ui/quick-replies.ts`'s `readQuickReplies` and the "only the
/// newest, only while incoming, only while open" gate from
/// `ui/message-list.ts`.
///
/// ── Everything here is untrusted ─────────────────────────────────────────
///
/// `ChatMessage.metadata` is an open `Map<String, Object?>?` a language model
/// populated by way of two services (quick-replies.ts's own header) — so the
/// parse below is exactly as defensive as `remote_config.dart`'s leaf
/// readers: a non-list, a non-string entry, a blank, or an absurd count is
/// dropped rather than rendered.
///
/// ── The handoff filter, which Dart was missing ───────────────────────────
///
/// A suggestion matching the tenant's `behaviour.handoffKeywords` must not
/// render. Escalation is keyword-only by the owner's call — the visible
/// "Talk to a human" button was removed — and a chip that escalates when
/// tapped IS that button back under a per-reply, LLM-authored name.
///
/// The judge is [asksForAHuman] itself: the SAME matcher the composer
/// escalates on, imported from `dhaam_chat`, never a second regex written
/// here. A chip is sent VERBATIM as the customer's message, so "would
/// tapping this escalate?" and "should this render?" are one question and
/// must have one answer. This is defence in depth — the server drops these
/// before they are stored — but the producer is an LLM two services away and
/// this row is where they render.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show ChatMessage, SenderType, asksForAHuman;

/// Most chips rendered from one message — `quick-replies.ts`'s own
/// `MAX_OPTIONS`. The prompt asks the model for 2-4; it will occasionally
/// return twenty, and a row of twenty chips would push the composer off a
/// phone screen. Extra ones are dropped rather than scrolled, because a
/// suggestion the customer cannot see is not a suggestion.
const int kMaxQuickReplies = 6;

/// Longest single chip — `quick-replies.ts`'s own `MAX_LABEL`. Past this it
/// is a sentence, not an option.
const int kMaxQuickReplyLabel = 80;

/// `message.metadata` → the chips to draw. Never throws.
///
/// [handoffKeywords] is the tenant's `RemoteConfig.handoffKeywords`, already
/// lower-cased and blank-free by the config parser — [asksForAHuman]'s own
/// contract. An empty list filters nothing, which is what "this merchant
/// configured no keywords" has to mean: filtering everything there would
/// leave every conversation with no suggestions at all.
List<String> readQuickReplies(
  Map<String, Object?>? metadata, {
  List<String> handoffKeywords = const <String>[],
}) {
  if (metadata == null) return const <String>[];
  final Object? raw = metadata['options'];
  if (raw is! List<Object?>) return const <String>[];

  final Set<String> seen = <String>{};
  for (final Object? entry in raw) {
    if (entry is! String) continue;
    final String label = entry.trim();
    // De-duplicated: a model asked for four options sometimes returns the
    // same one twice, and two identical chips read as a bug.
    if (label.isEmpty ||
        label.length > kMaxQuickReplyLabel ||
        seen.contains(label)) {
      continue;
    }
    // Judged BEFORE the cap is consumed, so a dropped handoff chip does not
    // cost a slot a legitimate suggestion could have used.
    if (asksForAHuman(label, handoffKeywords)) continue;
    seen.add(label);
    if (seen.length == kMaxQuickReplies) break;
  }
  return seen.toList(growable: false);
}

/// The transcript's own suggestions — the newest message's `options`, and
/// only while that message is not the customer's own.
///
/// Older messages' suggestions are stale by construction (they answered a
/// question two turns ago) and the customer's own message arriving is what
/// retires them.
///
/// [sessionClosed] is `message-list.ts`'s `closedReason !== null` gate: a
/// chip that would reopen nothing is a dead control. It defaults to `false`
/// because `ChatWidgetCubit` does not surface `ChatClient.sessionClosed`
/// yet (T10 adds it) — the default degrades to occasionally offering a chip
/// just after a close, never to hiding one that should show.
List<String> quickRepliesFor(
  List<ChatMessage> messages, {
  List<String> handoffKeywords = const <String>[],
  bool sessionClosed = false,
}) {
  if (sessionClosed || messages.isEmpty) return const <String>[];
  final ChatMessage newest = messages.last;
  if (newest.senderType == SenderType.customer) return const <String>[];
  return readQuickReplies(newest.metadata, handoffKeywords: handoffKeywords);
}
