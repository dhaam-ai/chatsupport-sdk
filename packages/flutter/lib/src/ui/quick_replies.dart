/// The bot's own suggested follow-ups — `metadata.options` on a message,
/// shown as chips under the newest one, but only while it is not the
/// customer's own. Ports `ui/quick-replies.ts`'s `readQuickReplies` and its
/// "only the newest, only while incoming" gate from `ui/message-list.ts`.
///
/// ── Everything here is untrusted ─────────────────────────────────────────
///
/// `ChatMessage.metadata` is an open `Map<String, Object?>?` a language
/// model populated by way of two services (quick-replies.ts's own header) —
/// so the parse below is exactly as defensive as `remote_config.dart`'s leaf
/// readers: a non-list, a non-string entry, a blank, or an absurd count is
/// dropped rather than rendered.
///
/// ── The one thing this package does NOT track ────────────────────────────
///
/// `message-list.ts` also gates on `closedReason === null` — no suggestions
/// once the session has closed, because a chip that would reopen nothing is
/// a dead control. This package's Cubit does not surface `ChatClient.
/// sessionClosed` yet (out of scope for this pass), so [quickRepliesFor]
/// gates only on "is the newest message incoming", a smaller but still
/// correct rule: it degrades to occasionally offering a chip after a close
/// rather than to ever hiding one that should show.
library;

import 'package:flutter/material.dart';

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage, SenderType;

/// Most chips rendered from one message — `quick-replies.ts`'s own
/// `MAX_OPTIONS`. The prompt asks the model for 2-4; it will occasionally
/// return more, and a row of twenty chips would push the composer off a
/// phone screen.
const int kMaxQuickReplies = 6;

/// Longest single chip — `quick-replies.ts`'s own `MAX_LABEL`. Past this it
/// is a sentence, not an option.
const int kMaxQuickReplyLabel = 80;

/// `message.metadata` → the chips to draw. Never throws.
List<String> readQuickReplies(Map<String, Object?>? metadata) {
  if (metadata == null) return const <String>[];
  final Object? raw = metadata['options'];
  if (raw is! List<Object?>) return const <String>[];

  final Set<String> seen = <String>{};
  for (final Object? entry in raw) {
    if (entry is! String) continue;
    final String label = entry.trim();
    // De-duplicated: a model asked for four options sometimes returns the
    // same one twice, and two identical chips read as a bug.
    if (label.isEmpty || label.length > kMaxQuickReplyLabel || seen.contains(label)) continue;
    seen.add(label);
    if (seen.length == kMaxQuickReplies) break;
  }
  return seen.toList(growable: false);
}

/// The transcript's own suggestions — the newest message's `options`, and
/// only while that message is not the customer's own. See this file's
/// header on the one JS gate (`closedReason`) this does not yet apply.
List<String> quickRepliesFor(List<ChatMessage> messages) {
  if (messages.isEmpty) return const <String>[];
  final ChatMessage newest = messages.last;
  if (newest.senderType == SenderType.customer) return const <String>[];
  return readQuickReplies(newest.metadata);
}

class QuickReplies extends StatelessWidget {
  const QuickReplies({super.key, required this.options, required this.onSelect});

  final List<String> options;

  /// The customer tapped one — send its text as though they had typed it.
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) return const SizedBox.shrink();

    return Semantics(
      // A group, not a list: these are controls, telling a screen-reader
      // user that what follows are suggestions rather than more of the
      // bot's message — same distinction quick-replies.ts's own
      // role="group" draws.
      container: true,
      label: 'Suggested replies',
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: <Widget>[
          for (final String option in options)
            ActionChip(label: Text(option), onPressed: () => onSelect(option)),
        ],
      ),
    );
  }
}
