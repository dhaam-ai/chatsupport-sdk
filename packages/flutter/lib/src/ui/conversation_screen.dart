/// The conversation screen — a transcript, quick-reply chips under the
/// newest bot message, and the composer. While
/// [ChatWidgetState.composingNew] is true, this renders [NewConversationView]
/// instead: see that field's own doc for why "new conversation" is a MODE of
/// this screen rather than a fourth [ScreenName].
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage, MessageDelivery, SenderType;

import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import 'new_conversation_view.dart';
import 'quick_replies.dart';
import 'composer.dart';

class ConversationScreen extends StatelessWidget {
  const ConversationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
      builder: (BuildContext context, ChatWidgetState state) {
        if (state.composingNew) return const NewConversationView();

        final ChatWidgetCubit cubit = context.read<ChatWidgetCubit>();
        final List<String> quickReplies = quickRepliesFor(state.messages);

        return Column(
          children: <Widget>[
            Expanded(child: _Transcript(messages: state.messages)),
            if (state.isTyping) const _TypingRow(),
            if (quickReplies.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: QuickReplies(options: quickReplies, onSelect: cubit.sendMessage),
              ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                child: Composer(onSend: cubit.sendMessage),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _Transcript extends StatelessWidget {
  const _Transcript({required this.messages});

  final List<ChatMessage> messages;

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'Send a message to get started.',
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ),
      );
    }

    // reverse: true anchors scroll position to the newest message without a
    // manually-managed ScrollController — the standard Flutter chat-list
    // pattern. `messages` is in ARRIVAL order (oldest first, per
    // ChatWidgetState's own doc), so index 0 here maps to the LAST entry.
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      itemCount: messages.length,
      itemBuilder: (BuildContext context, int index) {
        final ChatMessage message = messages[messages.length - 1 - index];
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: _MessageBubble(message: message),
        );
      },
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final bool outgoing = message.senderType == SenderType.customer;

    final Color bubbleColor = outgoing ? scheme.primary : scheme.surfaceContainerHighest;
    final Color textColor = outgoing ? scheme.onPrimary : scheme.onSurface;

    return Row(
      mainAxisAlignment: outgoing ? MainAxisAlignment.end : MainAxisAlignment.start,
      children: <Widget>[
        Flexible(
          child: Column(
            crossAxisAlignment: outgoing ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(color: bubbleColor, borderRadius: BorderRadius.circular(16)),
                child: Text(message.content, style: TextStyle(color: textColor)),
              ),
              if (outgoing)
                Padding(
                  padding: const EdgeInsets.only(top: 2, right: 2),
                  child: _DeliveryTick(delivery: message.delivery),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _DeliveryTick extends StatelessWidget {
  const _DeliveryTick({required this.delivery});

  final MessageDelivery delivery;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return switch (delivery) {
      MessageDelivery.pending => Icon(Icons.schedule, size: 12, color: scheme.onSurfaceVariant),
      MessageDelivery.confirmed => Icon(Icons.done, size: 12, color: scheme.onSurfaceVariant),
      // The same clock as `pending`, and deliberately not a distinct glyph.
      //
      // The two differ in where the message is (a socket's write buffer vs
      // this client's outbox) and not in anything the customer can act on: it
      // has not arrived yet, and it is going to. A third icon here would ask
      // them to learn a distinction that changes nothing they can do, while
      // the OfflineBanner above already explains, in a sentence, the one thing
      // this state means — and does it once for the whole thread instead of
      // once per bubble.
      //
      // `failed` is the one that gets its own treatment, because it is the one
      // where nothing further happens without a tap.
      MessageDelivery.queued => Icon(Icons.schedule, size: 12, color: scheme.onSurfaceVariant),
      MessageDelivery.failed => Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.error_outline, size: 12, color: scheme.error),
            const SizedBox(width: 2),
            Text('Not sent', style: TextStyle(fontSize: 10, color: scheme.error)),
          ],
        ),
    };
  }
}

class _TypingRow extends StatelessWidget {
  const _TypingRow();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const SizedBox(
            width: 24,
            height: 12,
            child: Center(child: Text('…')),
          ),
        ),
      ),
    );
  }
}
