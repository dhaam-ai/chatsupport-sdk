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

import 'package:dhaam_chat/dhaam_chat.dart' show ChatMessage, CsatRated;
import 'package:flutter/services.dart';

import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import '../surfaces/product_surface_slot.dart';
import 'attachments/attachments.dart';
import 'csat/csat.dart';
import 'message_list/message_list.dart';
import 'pre_chat/pre_chat.dart';
import 'new_conversation_view.dart';
import 'composer.dart';
import 'composer_affordances/composer_affordances.dart';

/// Where a surface's rejected submit goes.
///
/// The error object carries a stack and possibly a URL, so it goes to the
/// host's reporter and never onto the customer's screen — the split every
/// form in this package makes. Lifted out of the pre-chat arm now that three
/// surfaces want the same three lines.
void _report(Object error, StackTrace stackTrace) => FlutterError.reportError(
      FlutterErrorDetails(exception: error, stack: stackTrace),
    );

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

        // The surfaces that have landed are dispatched here. The rest
        // (offline, report) arrive with the nodes that build them and add
        // their own arm; an unhandled surface falls through to the
        // conversation rather than to a blank pane, which is the safe reading
        // while one is still to come.
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
              onError: _report,
            );
          case CsatSurface(
              :final String sessionId,
              :final bool alreadyRated,
            ):
            return CsatCardView(
              // The port of `openSurface`'s `${sessionId}:${ask|rated}` key.
              // The card for ONE session changes SHAPE when a rating is
              // recorded, and without a differing key Flutter reuses the
              // State — so the locked read-out would never draw over the ask
              // it replaces.
              key: ValueKey<String>(
                '$sessionId:${alreadyRated ? 'rated' : 'ask'}',
              ),
              style: state.config.csatStyle,
              // Read from the mirror of the CSAT machine, which is the single
              // memory of what the server said. The slot deliberately carries
              // only the flag, so no copy of the rating can go stale beside
              // it.
              existing: switch (state.csatBySession[sessionId]) {
                final CsatRated rated when alreadyRated => rated,
                _ => null,
              },
              onSubmit: (int rating, String? comment) => cubit.rateSession(
                sessionId,
                rating: rating,
                comment: comment,
              ),
              onError: _report,
            );
          case ConfirmEndSurface(:final String sessionId):
            return EndConversationConfirm(
              onConfirm: () => cubit.confirmEndConversation(sessionId),
              onCancel: cubit.cancelEndConversation,
              onError: _report,
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
                  // Fills the second seam T9 declared and left empty, which
                  // until now removed the Reply item from every message menu
                  // in the transcript.
                  //
                  // The sender name arrives from the transcript rather than
                  // being resolved here: a ChatMessage carries no display
                  // name, and only the message list holds the bot-name memory
                  // and the participant snapshot that produce one. Resolving
                  // it a second way here is exactly the duplication that
                  // callback's own doc exists to prevent.
                  //
                  // Straight to the Cubit, and NOT into this widget's own
                  // state: the send that consumes the target is the Cubit's,
                  // so a copy held here would be a second answer it could not
                  // see and could not clear in step with a send — and it
                  // would die on the next rebuild, taking the customer's
                  // reply with it.
                  onReplyToMessage: (ChatMessage message, String senderName) =>
                      cubit.replyTo(
                    ReplyTarget.from(message, senderName: senderName),
                  ),
                ),
                // Fills the seam T9 declared and deliberately left empty.
                // Ungated by `fileUploads`: that flag governs whether the
                // customer may SEND a file, not whether an attachment
                // already in the transcript is drawn. A merchant who turns
                // uploads off does not thereby blank out the photo an agent
                // sent yesterday.
                attachmentBuilder: buildAttachmentBubble,
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                // The ended footer is a SIBLING of the composer, not a
                // product surface: the customer is deciding about the
                // transcript they are looking at, and hiding it to show two
                // buttons would take away the thing being decided about. So
                // the two trade places here — the same "one at a time" rule
                // the slot enforces, applied one level lower.
                child: cubit.endedFooterDue
                    ? EndedFooter(
                        // Hidden when the host wired up no
                        // `ChatSessionActions`: a Reopen that quietly does
                        // nothing is worse than no Reopen.
                        onReopen:
                            cubit.canReopen ? cubit.reopenEndedSession : null,
                        onStartNew: cubit.startNewConversation,
                        onError: _report,
                      )
                    : Composer(
                        onSend: cubit.sendMessage,
                        controller: _composer,
                        // Nothing on the Flutter side drove the agent's
                        // typing indicator before this line — for typed
                        // characters as much as for an emoji insertion.
                        onTyping: cubit.startTyping,
                        // Read from state on every build, so the chip
                        // survives a rebuild that has nothing to do with it.
                        // `sendMessage` is what clears it — see its own doc
                        // on why that belongs there and not here.
                        replyTo: state.replyingTo,
                        onCancelReply: () => cubit.replyTo(null),
                      ),
              ),
            ),
          ],
        );
      },
    );
  }
}
