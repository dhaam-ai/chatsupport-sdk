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

import 'package:dhaam_chat/dhaam_chat.dart'
    show ChatMessage, CsatRated, RetryOutcome, RetryRefused;
import 'package:flutter/services.dart';

import '../state/chat_widget_cubit.dart';
import '../state/chat_widget_state.dart';
import '../surfaces/product_surface_slot.dart';
import 'attachments/attachments.dart';
import 'consent/consent.dart';
import 'csat/csat.dart';
import 'header/header.dart';
import 'message_list/message_list.dart';
import 'pre_chat/pre_chat.dart';
import 'new_conversation_view.dart';
import 'offline_form/offline_form.dart';
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

  /// This composer's pending attachment, or null when the host wired no
  /// uploader — in which case the composer grows no attach controls at all.
  ///
  /// ── Built here because a draft is this screen's, not the Cubit's ─────
  ///
  /// The two seams behind it (`AttachmentPicker`, `AttachmentUploader`) live
  /// on the Cubit, because it is the only thing a host hands to
  /// `ChatWidget`. The DRAFT does not: it is one composer's pending file and
  /// it should die with the screen. A controller on the Cubit would carry a
  /// chosen file across a navigation away and back, and would outlive the
  /// widget that is the only thing able to show its status sentence.
  ///
  /// Deliberately NOT rebuilt in `build`: it is a `ChangeNotifier` holding
  /// the customer's chosen file, and re-creating it on every rebuild — a
  /// keystroke, a message arriving — would drop that file on the floor
  /// between picking it and pressing Send.
  AttachmentDraftController? _attachments;

  @override
  void initState() {
    super.initState();
    // `read`, not `watch`: this needs the Cubit once, to build a controller,
    // and nothing about the seams it carries can change afterwards.
    _attachments = context
        .read<ChatWidgetCubit>()
        .createAttachmentDraft(onError: _report);
  }

  @override
  void dispose() {
    // Owns a lifetime — `AttachmentDraftController`'s own rule. This is also
    // what makes its `_disposed` guard load-bearing rather than defensive: an
    // upload can still be in flight when the customer navigates away, and its
    // `finally` runs regardless.
    _attachments?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
      builder: (BuildContext context, ChatWidgetState state) {
        final ChatWidgetCubit cubit = context.read<ChatWidgetCubit>();
        // Derived ONCE and read twice below — by the notice and by the
        // composer it gates. Two derivations of "is consent in force" is how
        // a notice ends up on screen above a composer that still works, or a
        // composer held shut behind a notice that renders nothing.
        final bool consentIsGating = consentGating(state.config);

        // All six surfaces are dispatched here. `case _` is now unreachable
        // in practice — it is kept because `ProductSurface` is sealed and a
        // SEVENTH surface added later should fall through to the conversation
        // rather than to a blank pane, which stays the safe reading for a
        // surface whose arm has not been written yet.
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
          case OfflineSurface():
            return OfflineFormView(
              // The merchant's pre-chat questions gate this surface too, and
              // through the SAME function the standalone gate and the
              // new-conversation form use — a signed-in visitor is not asked
              // to type their own email address back just because the team
              // happens to be closed.
              //
              // The form's own two built-ins are NOT covered by that gate and
              // are asked regardless: they are the reply channel for an
              // answer that will arrive out of band, and an agent reading
              // this tomorrow morning has no socket to answer down.
              //
              // One deliberate difference from the reference, which spells
              // this branch out as `preChatEnabled && isGuest` inline: going
              // through `preChatFieldsToAsk` also weighs `preChatAnswered`, so
              // a customer who has already answered these questions in this
              // session is not asked them a second time here. That is the
              // rule the other two surfaces follow, and re-deriving the gate
              // inline to avoid it would be the second derivation this
              // package keeps ending up burned by.
              extraFields: preChatFieldsToAsk(
                config: state.config,
                isGuest: state.isGuest,
                alreadyAnswered: state.preChatAnswered,
              ),
              onSubmit: cubit.submitOfflineMessage,
              onError: _report,
              offlineMessage: state.config.offlineMessage,
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
          case ReportSurface():
            return ReportIssueForm(
              onSubmit: cubit.fileIssueReport,
              // The same callback for Cancel and for the confirmation's Done,
              // because the job is the same one — see `ReportIssueForm`'s own
              // `onCancel`, which is deliberately one callback and not two.
              onCancel: cubit.cancelReportIssue,
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
                  // Fills the LAST seam T9 declared and left empty. Until the
                  // `MessageDelivery` union, `null` here was the honest state:
                  // no truthful per-message replay existed, and wiring the
                  // button to the connection's `retryNow` would have been a
                  // control that cannot do what its label says (D27).
                  //
                  // The button is already gated on `MessageFailed.retryable`
                  // by the projection, so `notRetryable` should never come
                  // back. `disconnected` still can — a connection can drop
                  // between drawing the button and the press — and a refusal
                  // that changed nothing on screen would read as a success,
                  // so it goes to the same reporter every form here uses.
                  onRetry: (ChatMessage message) {
                    final RetryOutcome outcome = cubit.retryMessage(message.id);
                    if (outcome is RetryRefused) {
                      _report(
                        StateError('retry refused: ${outcome.reason.name}'),
                        StackTrace.current,
                      );
                    }
                  },
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
            ConsentNotice(
              gating: consentIsGating,
              agreed: state.consentAgreed,
              // Empty-safe: `consentGating` is already false for a merchant
              // who wrote nothing, so this string is only ever read when
              // there is something in it.
              text: state.config.consentText ?? '',
              onAgree: cubit.agreeToConsent,
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
                        // The consent gate, and the whole of it: a visitor
                        // who has not agreed may read everything above and
                        // send nothing, because sending is the act that
                        // creates the record the notice is about. `enabled`
                        // is a prop `Composer` already took and T13's
                        // chip-submit guard already reads, so a suggestion
                        // chip cannot route round this — see [_composer].
                        enabled: consentSatisfied(
                          gating: consentIsGating,
                          agreed: state.consentAgreed,
                        ),
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
                        // The composer hop D23 named: the attach button, the
                        // draft bar and the three submit guards were all
                        // built, tested and reachable by nobody, because
                        // this line did not exist.
                        //
                        // Null when the host wired no uploader, which draws
                        // no paperclip — the same "off, not broken" rule the
                        // ⋯ menu applies to an unbacked row.
                        attachments: _attachments,
                        // Its OWN message, per §12.10 — the URL travels as
                        // the content and the media type becomes the message
                        // type. `Composer._submit` calls this first and
                        // `onSend` after, exactly as `composer.ts` does, so
                        // a file with a caption is two messages and a file
                        // alone is one.
                        onSendAttachment: cubit.sendAttachment,
                        // The merchant's switch, read here and nowhere else
                        // — `AttachmentDraftController` deliberately knows
                        // nothing about `RemoteConfig`, so there is exactly
                        // one derivation of "may this customer attach".
                        //
                        // Read from state on every build rather than
                        // captured, so a config that lands after the
                        // composer is on screen turns the paperclip on
                        // without a remount.
                        fileUploads: state.config.fileUploads,
                      ),
              ),
            ),
          ],
        );
      },
    );
  }
}
