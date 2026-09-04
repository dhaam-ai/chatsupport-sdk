/// The conversation screen — a transcript, quick-reply chips under the
/// newest bot message, and the composer — or, when a product surface holds
/// the slot, that surface INSTEAD.
///
/// ── In place of, never alongside ───────────────────────────────────────
///
/// A surface stands IN PLACE OF the transcript and composer rather than
/// stacking above them. A form asking the customer for something and the
/// conversation it gates are alternatives, not a pile — and leaving a
/// composer underneath a gate is leaving a way to type into a conversation
/// the gate exists to hold back.
///
/// The dispatch below is over `state.activeSurface`, which is a mirror of the
/// one [ProductSurfaceSlot]. It is deliberately NOT a second reading of
/// config or session state: which surface belongs here is
/// `resolveProductSurface`'s decision, already made.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage;
import 'package:flutter/services.dart';

import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import '../surfaces/product_surface_slot.dart';
import 'message_list/message_list.dart';
import 'pre_chat/pre_chat.dart';
import 'new_conversation_view.dart';
import 'composer.dart';
import 'composer_affordances/composer_affordances.dart';

class ConversationScreen extends StatefulWidget {
  const ConversationScreen({super.key});

  @override
  State<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends State<ConversationScreen> {
  /// A quick-reply chip is a message the customer sends, so it goes through
  /// the composer's own [ComposerController.submit] rather than straight to
  /// the client.
  ///
  /// Calling `cubit.sendMessage` from the chip would be shorter and would
  /// give a suggestion its own path — the one thing `composer.ts` says never
  /// to do. `enabled` on the composer is where the consent gate lives, so a
  /// chip with a private route is a way around consent: a visitor who has not
  /// agreed taps a suggestion and a record is created anyway. It is also what
  /// keeps a chip from overwriting a half-typed draft.
  final ComposerController _composer = ComposerController();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
      builder: (BuildContext context, ChatWidgetState state) {
        final ChatWidgetCubit cubit = context.read<ChatWidgetCubit>();

        // Only the two surfaces this node owns are dispatched here. The
        // others (offline, CSAT, report, confirm-end) land with the nodes
        // that build them and add their own arm; an unhandled surface falls
        // through to the conversation rather than to a blank pane, which is
        // the safe reading while one is still to come.
        switch (state.activeSurface) {
          case ComposingNewSurface():
            return const NewConversationView();
          case PreChatSurface():
            return PreChatGate(
              fields: preChatFieldsToAsk(
                config: state.config,
                isGuest: state.isGuest,
                alreadyAnswered: state.preChatAnswered,
              ),
              onSubmit: cubit.submitPreChat,
              onSkip: cubit.skipPreChat,
              // The error object carries a stack and possibly a URL. It goes
              // to the host's reporter, never onto the customer's screen.
              onError: (Object error, StackTrace stackTrace) =>
                  FlutterError.reportError(
                FlutterErrorDetails(exception: error, stack: stackTrace),
              ),
            );
          case _:
            break;
        }

        return Column(
          children: <Widget>[
            Expanded(
              child: MessageListView(
                inputs: MessageListInputs(
                  messages: state.messages,
                  session: state.session,
                  isTyping: state.isTyping,
                  readWatermarks: readWatermarksFrom(state.session),
                  handoffKeywords: state.config.handoffKeywords,
                  localParticipantId: state.localParticipantId,
                  // The ack that carries the session snapshot is also what
                  // carries the replay, so holding one is the closest this
                  // package has to "the first page has come back".
                  initialLoaded: state.session != null,
                ),
                callbacks: MessageListCallbacks(
                  onCopyMessage: (ChatMessage message) => Clipboard.setData(
                    ClipboardData(text: visibleContent(message)),
                  ),
                  // Through the composer, never round it — see [_composer].
                  onQuickReply: _composer.submit,
                ),
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                child: Composer(
                  onSend: cubit.sendMessage,
                  controller: _composer,
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
