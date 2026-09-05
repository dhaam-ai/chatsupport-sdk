/// The New Conversation screen's topic chips — `behaviour.conversationTopics`
/// (see remote_config.dart's [ConversationTopic]), a single-select toggle a
/// customer can optionally narrow their conversation with before typing.
///
/// Built on Material's [ChoiceChip] — "a single choice from a set," with
/// `selected` a plain per-chip boolean the CALLER controls (confirmed
/// against api.flutter.dev: ChoiceChip enforces no group exclusivity of its
/// own), which is exactly this widget's shape: zero-or-one selected,
/// [ChatWidgetCubit.selectTopic]'s own toggle owns the "at most one" rule.
library;

import 'package:flutter/material.dart';

import '../config/remote_config.dart';

class TopicChips extends StatelessWidget {
  const TopicChips(
      {super.key,
      required this.topics,
      required this.selected,
      required this.onSelect});

  final List<ConversationTopic> topics;

  /// `null` — nothing picked, the common case for a customer who does not
  /// need to narrow their question before typing it.
  final ConversationTopic? selected;

  /// Fires for the topic that was TAPPED, whether that selects or (tapping
  /// an already-selected chip again) un-selects it — the toggle logic lives
  /// in [ChatWidgetCubit.selectTopic], not here.
  final ValueChanged<ConversationTopic> onSelect;

  @override
  Widget build(BuildContext context) {
    // Absent config ⇒ behaves as before: no chips, not an invented list —
    // same rule parseConversationTopics documents for the empty case.
    if (topics.isEmpty) return const SizedBox.shrink();

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: <Widget>[
        for (final ConversationTopic topic in topics)
          ChoiceChip(
            label: Text(topic.label),
            selected: topic == selected,
            onSelected: (_) => onSelect(topic),
          ),
      ],
    );
  }
}
