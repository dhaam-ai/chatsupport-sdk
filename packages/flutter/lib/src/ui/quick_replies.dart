/// The bot's suggested-follow-up chip row.
///
/// The PARSE half — `readQuickReplies` / `quickRepliesFor`, and their two
/// caps — moved to `message_list/quick_reply_options.dart` when the handoff
/// filter landed. There is exactly one implementation: a chip is sent
/// verbatim as the customer's message, so "would tapping this escalate?" and
/// "should this render?" are one question judged by one matcher, and a
/// second copy of the parse here is how those two answers drift apart.
/// It is re-exported below so this file stays the one import path every
/// existing call site — `conversation_screen.dart` included — already uses.
library;

import 'package:flutter/material.dart';

export 'message_list/quick_reply_options.dart'
    show
        kMaxQuickReplies,
        kMaxQuickReplyLabel,
        quickRepliesFor,
        readQuickReplies;

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
