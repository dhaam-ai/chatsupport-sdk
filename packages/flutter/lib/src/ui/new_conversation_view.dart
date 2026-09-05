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
import '../forms/forms.dart';
import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import '../theme/chat_theme.dart';
import 'pre_chat/pre_chat.dart';
import 'topic_chips.dart';

class NewConversationView extends StatefulWidget {
  const NewConversationView({super.key});

  @override
  State<NewConversationView> createState() => _NewConversationViewState();
}

class _NewConversationViewState extends State<NewConversationView> {
  final TextEditingController _message = TextEditingController();

  /// The merchant's pre-chat questions, folded in above the message box.
  ///
  /// Built ONCE, in [initState], from [preChatFieldsToAsk] — never re-derived
  /// in `build`. Two reasons, and both are bugs that have happened: rebuilding
  /// would throw away the controllers with whatever the customer had typed
  /// into them, and asking the gate question again on every state tick is a
  /// second answer that can disagree with the one the slot was resolved
  /// against.
  late final PreChatFieldSet _fields;

  late final FormSubmitController _submit = FormSubmitController(
    label: 'Start',
    busyLabel: 'Starting…',
  );

  @override
  void initState() {
    super.initState();
    final ChatWidgetState state = context.read<ChatWidgetCubit>().state;
    _fields = PreChatFieldSet(
      preChatFieldsToAsk(
        config: state.config,
        // The single derivation, forwarded — see ChatIdentity.isGuest.
        isGuest: state.isGuest,
        alreadyAnswered: state.preChatAnswered,
      ),
    );
    // Start's enabled state depends on the textarea's own content — see
    // build()'s `canStart` — so this widget has to rebuild on every
    // keystroke, not just on Cubit state changes.
    _message.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _fields.dispose();
    _submit.dispose();
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
          // Details first, message second — top to bottom, the order the
          // customer reads. Naming the message as missing while a required
          // field above it is also empty sends them to the wrong box.
          if (!_submit.requireAll(_fields.views)) return;

          final String text = _message.text.trim();
          if (text.isEmpty) {
            _submit.showStatus('Tell us what you need help with.');
            return;
          }

          cubit.startConversationFrom(
            message: text,
            // The chip's LABEL, never its id: the id is a console key, and
            // what reaches the agent should be what the customer saw
            // themselves press.
            topic: state.selectedTopic?.label,
            // null when nothing was asked, a (possibly empty) map when it
            // was. Those are different answers — see preChatAnswersFor.
            answers: _fields.answers,
          );
        }

        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              // Renders nothing at all when the visitor is signed in, the
              // merchant configured no questions, or they were already
              // answered — so there is no `if` here to get wrong.
              PreChatFieldsBlock(fields: _fields),
              if (_fields.isNotEmpty) const SizedBox(height: 16),
              if (config.conversationTopics.isNotEmpty) ...<Widget>[
                Text('What can we help with?',
                    style: Theme.of(context).textTheme.titleSmall),
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
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(radius)),
                ),
              ),
              const SizedBox(height: 8),
              FormStatusLine(controller: _submit),
              const SizedBox(height: 4),
              FilledButton(
                onPressed: canStart ? start : null,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(44),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(radius)),
                ),
                child: const Text('Start'),
              ),
              // Backs out to the screen this form was opened FROM — Home to
              // Home, Messages to Messages. Finishing a detour on the
              // conversation screen strands the customer on an empty
              // transcript having pressed Cancel.
              TextButton(
                onPressed: cubit.cancelNewConversation,
                child: const Text('Cancel'),
              ),
            ],
          ),
        );
      },
    );
  }
}
