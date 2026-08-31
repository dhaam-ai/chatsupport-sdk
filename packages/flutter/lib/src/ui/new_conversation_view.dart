/// The New Conversation composing view — topic chips, a message textarea,
/// and Start. Shown by the conversation screen while
/// [ChatWidgetState.composingNew] is true (see that field's own doc on why
/// this is a MODE of the conversation screen rather than a fourth
/// [ScreenName]).
///
/// No "attach my active order" checkbox — deliberately out of scope (SDK
/// plan §D): chat-service's commerce routes are agent/admin-tier, a
/// customer token cannot reach them, and a checkbox wired to nothing is
/// exactly the control this package's brief says never to ship.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../config/remote_config.dart';
import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import '../theme/chat_theme.dart';
import 'topic_chips.dart';

class NewConversationView extends StatefulWidget {
  const NewConversationView({super.key});

  @override
  State<NewConversationView> createState() => _NewConversationViewState();
}

class _NewConversationViewState extends State<NewConversationView> {
  final TextEditingController _message = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Start's enabled state depends on the textarea's own content — see
    // build()'s `canStart` — so this widget has to rebuild on every
    // keystroke, not just on Cubit state changes.
    _message.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
      builder: (BuildContext context, ChatWidgetState state) {
        final ChatWidgetCubit cubit = context.read<ChatWidgetCubit>();
        final RemoteConfig config = state.config;
        final double radius = chatCornerRadius(config);
        final bool canStart = _message.text.trim().isNotEmpty;

        void start() {
          final String text = _message.text.trim();
          if (text.isEmpty) return;
          cubit.sendMessage(text);
        }

        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (config.conversationTopics.isNotEmpty) ...<Widget>[
                Text('What can we help with?', style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 8),
                TopicChips(
                  topics: config.conversationTopics,
                  selected: state.selectedTopic,
                  onSelect: cubit.selectTopic,
                ),
                const SizedBox(height: 16),
              ],
              TextField(
                controller: _message,
                minLines: 4,
                maxLines: 8,
                textInputAction: TextInputAction.newline,
                decoration: InputDecoration(
                  hintText: 'Type your message…',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(radius)),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: canStart ? start : null,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(44),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
                ),
                child: const Text('Start'),
              ),
            ],
          ),
        );
      },
    );
  }
}
