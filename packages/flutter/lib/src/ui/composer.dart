/// The conversation composer: a text field with an icon row inside its own
/// border — mirrors the reference's `ui/composer.ts` `.dh-composer-row`,
/// "image/emoji/attach/link... INSIDE the input's border".
///
/// ── Every insertion has THREE effects, and they share one funnel ─────────
///
/// A glyph or a URL arriving in the box is a text change like any other, so
/// it must do everything a keystroke does. `_afterInsertion` is the one place
/// that happens, because each of the three is a real bug when skipped:
///
///   1. **Autogrow.** The box has to accommodate what was just put in it.
///      Flutter does this for us — `minLines: 1, maxLines: 5` on the field
///      below re-measures on any value change — which is exactly why it is
///      named here: the effect is not ours to run, but it IS ours to keep,
///      and deleting those two arguments would silently remove it.
///   2. **Send-state sync.** Without it an emoji-only message leaves Send
///      disabled — the customer picks 👍, and the widget refuses to send it.
///   3. **`onTyping`.** Without it the agent's typing indicator goes out
///      while the customer is picking glyphs, so the agent is told the
///      customer stopped writing at the moment they are choosing what to say.
///
/// ── Both popovers live in the widget, never in platform chrome ───────────
///
/// The link affordance used to be a `prompt()` in the JS original. That was
/// the HOST page's dialog rather than the widget's: unthemed, outside the
/// widget's own root, and absent entirely where the host had stubbed it out
/// — so "add link" looked like a button that did nothing. Same reasoning that
/// moved end-conversation off `confirm()`: a question the widget asks belongs
/// inside the widget. Both popovers here are ordinary widgets stacked above
/// the field.
///
/// ── All four icons, and where each one's state lives ─────────────────────
///
/// `composer.ts` has attach, emoji, mic and link inside the border, and so
/// does this. None of the four owns its own state here: emoji and link are
/// popovers over a controller-free field, while attach and mic are drawn from
/// [Composer.attachments] and [Composer.voice] — two controllers this widget
/// renders and never constructs, because the picker, the uploader and the
/// microphone all belong to the host that has them.
///
/// ── "Is an upload in flight" is ONE fact ─────────────────────────────────
///
/// [Composer.uploading] was a plain parameter because the upload belonged to
/// another node. Now that the draft controller is here, `_uploading` is the
/// single answer, combining the parameter with
/// `AttachmentDraftController.canSend`, and **every** consumer reads it: the
/// send button, the affordance gate, and the `uploading` argument
/// [chipSubmitRefusal] takes. Two derivations of that flag would let a
/// suggestion chip send during the very upload the send button is refusing —
/// which is the concrete bug the unification prevents, not a tidiness point.
///
/// ── The reply chip renders a target it does not own ──────────────────────
///
/// [Composer.replyTo] is the same shape as [Composer.uploading]: a fact this
/// widget DRAWS and never stores. Which message a send is addressed to lives
/// on `ChatWidgetState.replyingTo`, because it is the Cubit that calls
/// `sendMessage` and a copy here would be a second owner of one fact.
///
/// `onSend` stays a `ValueChanged<String>` for exactly that reason — it
/// carries text and nothing else, so a reply cannot travel back out of this
/// widget even by accident. That is also what keeps a reply on the SAME
/// `_submit` path a typed message and a suggestion chip take, and therefore
/// subject to the same consent gate.
library;

import 'dart:async';

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:flutter/material.dart';

import 'attachments/attachments.dart';
import 'composer_affordances/composer_affordances.dart';
import 'voice/voice.dart';

class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.onSend,
    this.radius = 24,
    this.enabled = true,
    this.uploading = false,
    this.onTyping,
    this.controller,
    this.replyTo,
    this.onCancelReply,
    this.attachments,
    this.onSendAttachment,
    this.fileUploads = false,
    this.voice,
    this.onVoiceRecorded,
  });

  /// The customer submitted [text] — already trimmed, always non-blank.
  final ValueChanged<String> onSend;
  final double radius;
  final bool enabled;

  /// An attachment is on its way to the server.
  ///
  /// Refuses a suggestion chip and shuts every affordance, the same way
  /// `composer.ts`'s `setUploading` does. Declared here rather than owned
  /// internally because the upload itself belongs to the attachment node —
  /// this widget only needs to know that one is in flight.
  final bool uploading;

  /// The customer changed the draft. Fired for a keystroke AND for an
  /// insertion made by the emoji or link affordance, because to the agent
  /// waiting at the other end those are the same event: somebody is writing.
  final VoidCallback? onTyping;

  /// The seam a suggestion chip sends through. See [ComposerController].
  final ComposerController? controller;

  /// The message being replied to, drawn as a chip above the box — or `null`
  /// for no reply in progress. The port of `composer.ts`'s
  /// `setReplyTo(target | null)`.
  ///
  /// Rendered here, owned elsewhere; see this library's own header.
  final ReplyTarget? replyTo;

  /// The customer dismissing the quoted message they were replying to.
  ///
  /// `null` draws the chip WITHOUT a dismiss control, which is a state no
  /// caller should reach: a reply target the customer cannot back out of
  /// traps a mistaken tap. A caller that supplies [replyTo] supplies this.
  final VoidCallback? onCancelReply;

  /// The pending attachment, or `null` for a composer that cannot attach.
  ///
  /// Drawn here, owned by the host: the picker and the uploader behind it are
  /// the host's to supply, and a controller constructed in this widget would
  /// be rebuilt away with it — taking the customer's chosen file along.
  final AttachmentDraftController? attachments;

  /// An attachment finished uploading and is ready to be announced.
  ///
  /// Separate from [onSend] rather than folded into it, exactly as
  /// `composer.ts` keeps `onSendAttachment` separate from `onSend`. Keeping
  /// [onSend] a `ValueChanged<String>` is load-bearing — see this library's
  /// header — and a send may legitimately carry a file, some words, or both.
  final ValueChanged<AttachmentMetadata>? onSendAttachment;

  /// `RemoteConfig.fileUploads`. False renders no paperclip at all.
  ///
  /// The gate is read here and nowhere else, which is
  /// [AttachmentAttachButton]'s own rule: `AttachmentDraftController`
  /// deliberately knows nothing about `RemoteConfig`, so there is exactly one
  /// derivation of "may this customer attach".
  ///
  /// Defaults to **false**, and that default is deliberate: a composer built
  /// before the config has landed must not offer a feature the merchant may
  /// have turned off. The same fail-safe direction `RemoteConfig.sound` takes.
  final bool fileUploads;

  /// Voice capture, or `null` for a composer with no microphone.
  ///
  /// `null` renders no mic button — see [VoiceRecordButton] for why an absent
  /// control is the honest one when no [VoiceDevice] has been supplied.
  final VoiceCaptureController? voice;

  /// Told about a finished voice note, after it has become the draft.
  ///
  /// ── This is now a notification, not the delivery ─────────────────────
  ///
  /// It used to be the delivery, and its own doc said why: a note becomes a
  /// message by becoming a draft, `AttachmentDraftController` accepted
  /// drafts only from its own picker, and "until it can take one from
  /// outside, the host is the only party that can complete that hop". It can
  /// take one from outside now (`setDraft`), so this widget makes the hop
  /// itself and a host is told rather than conscripted.
  ///
  /// Optional, and nothing in this package supplies it — a voice note takes
  /// the ordinary attachment path from here, so there is nothing left for a
  /// caller to do. It stays because a host may reasonably want to know one
  /// was recorded (an analytics ping, its own undo affordance), and because
  /// a widget that made the hop AND refused to say so would be the harder of
  /// the two to work with.
  final ValueChanged<VoiceRecording>? onVoiceRecorded;

  @override
  State<Composer> createState() => _ComposerState();
}

/// Which popover, if any, is showing above the message box.
///
/// One slot rather than two booleans: they are alternatives, and two flags
/// admit a state — both open — that has no meaning and that nothing would
/// ever close.
enum _Popover { none, emoji, link }

class _ComposerState extends State<Composer> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();
  final FocusNode _emojiButtonFocus = FocusNode();
  final FocusNode _linkButtonFocus = FocusNode();

  _Popover _popover = _Popover.none;

  /// Held so the same closure that was attached is the one withdrawn — see
  /// [ComposerController.detach] on why identity matters during a rebuild.
  late final ChipSubmitRefusal? Function(String) _submitSuggestion =
      _submitSuggestionImpl;

  @override
  void initState() {
    super.initState();
    // The send button's enabled state depends on the field's own content —
    // same reasoning composer.ts's syncSendState gives for re-checking on
    // every input event.
    _controller.addListener(() => setState(() {}));
    widget.controller?.attach(_submitSuggestion);
    // The send button, the affordance gate and the popover rule all read the
    // draft controller, so this widget has to rebuild when it changes — the
    // two attachment widgets' own `ListenableBuilder`s only cover
    // themselves.
    widget.attachments?.addListener(_onAttachmentsChanged);
  }

  void _onAttachmentsChanged() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(Composer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.controller, widget.controller)) {
      oldWidget.controller?.detach(_submitSuggestion);
      widget.controller?.attach(_submitSuggestion);
    }
    if (!identical(oldWidget.attachments, widget.attachments)) {
      oldWidget.attachments?.removeListener(_onAttachmentsChanged);
      widget.attachments?.addListener(_onAttachmentsChanged);
    }
    // A disabled or uploading composer must not leave a popover open: its
    // trigger is dead in both states, so the popover would be unreachable and
    // unclosable by pointer. Same rule `composer.ts`'s syncSendState applies.
    if (!_affordancesEnabled && _popover != _Popover.none) {
      _popover = _Popover.none;
    }
    // The port of `startReply`'s `composer.input.focus()`. The customer
    // pressed Reply in a menu halfway up the transcript; landing them on the
    // box is the difference between one gesture and two.
    //
    // Guarded on the target having actually CHANGED, not merely being
    // present: [ReplyTarget] compares by value, so an unrelated rebuild
    // carrying the same target re-focuses nothing and cannot steal the caret
    // back from wherever the customer put it. Guarded on `enabled` because a
    // disabled field cannot take focus and asking it to is a no-op worth not
    // performing.
    if (widget.replyTo != null &&
        widget.replyTo != oldWidget.replyTo &&
        widget.enabled) {
      _focusNode.requestFocus();
    }
  }

  @override
  void dispose() {
    widget.controller?.detach(_submitSuggestion);
    // Removed, never disposed: the controller outlives this widget and
    // belongs to whoever built it.
    widget.attachments?.removeListener(_onAttachmentsChanged);
    _controller.dispose();
    _focusNode.dispose();
    _emojiButtonFocus.dispose();
    _linkButtonFocus.dispose();
    super.dispose();
  }

  /// **The one answer to "is an upload in flight".**
  ///
  /// [Composer.uploading] is the flag a caller with no draft controller
  /// passes; `canSend` is the same fact when there IS one. Combined here,
  /// once, so the send button and [chipSubmitRefusal] cannot disagree — see
  /// this library's header for the bug two derivations would allow.
  bool get _uploading =>
      widget.uploading || !(widget.attachments?.canSend ?? true);

  bool get _affordancesEnabled => widget.enabled && !_uploading;

  /// The three effects every insertion has. See this library's own doc for
  /// why each one is a real bug when skipped, and why they share a funnel.
  void _afterInsertion() {
    // 1. Autogrow is the field's own (`minLines`/`maxLines`) and needs no
    //    call here — see the library doc. 2. Send-state sync:
    setState(() {});
    // 3. The agent is still being written to.
    widget.onTyping?.call();
  }

  void _insert(String text) {
    insertAtCaret(_controller, text);
    // Focus returns to the box so the next keystroke continues in place,
    // which is the point of having inserted at the caret at all.
    _focusNode.requestFocus();
    _afterInsertion();
  }

  void _togglePopover(_Popover which) {
    setState(() {
      _popover = _popover == which ? _Popover.none : which;
    });
  }

  void _closePopover(FocusNode returnFocusTo) {
    if (_popover == _Popover.none) return;
    setState(() => _popover = _Popover.none);
    // Focus goes back to the control that opened it, so a keyboard customer
    // is not dropped at the top of the screen by dismissing a popover.
    returnFocusTo.requestFocus();
  }

  /// The one send path — typed, suggested, or a file.
  ///
  /// ── The order is upload FIRST, then clear, then announce ─────────────
  ///
  /// `composer.ts` clears the box and the pending file BEFORE awaiting the
  /// upload. That is right for the TEXT — `dhaam_chat`'s `ChatClient` marks an
  /// unreachable send failed rather than losing it, so re-showing the words
  /// would only invite a duplicate send — and wrong for the FILE, because
  /// nothing queues an upload: if the bytes did not land, the only copy is
  /// the one in the draft controller.
  ///
  /// So the clear moves after the await, and the three guards below are what
  /// make that safe. They are `AttachmentDraftController`'s own specified
  /// contract, not this widget's invention; see `uploadDraft`'s doc for why
  /// `hasDraft` after the await is the literal fact rather than a result code.
  ///
  /// A file with no words is a message. `composer.ts` guards on
  /// `text === '' && file === null`, not on the text alone, and a composer
  /// that refused to send a photo without a caption would be refusing the
  /// commonest attachment there is.
  Future<void> _submit() async {
    final String text = _controller.text.trim();
    final AttachmentDraftController? attachments = widget.attachments;
    if (text.isEmpty && !(attachments?.hasDraft ?? false)) return;

    AttachmentMetadata? file;
    if (attachments != null) {
      if (!attachments.canSend) return; // in-flight upload blocks send
      file = await attachments.uploadDraft();
      if (attachments.hasDraft) return; // upload failed; draft + text kept
    }

    // Past the guards the send is committed, so the box is cleared before
    // either callback runs — the reference's own optimistic clear, moved to
    // the first point at which nothing can still refuse the send.
    _controller.clear();
    if (file != null) widget.onSendAttachment?.call(file);
    if (text.isNotEmpty) widget.onSend(text);
  }

  /// A finished voice note becomes the pending attachment.
  ///
  /// ── The last hop, and why it goes through the SAME door as a photo ────
  ///
  /// `composer.ts` does exactly this: its `toggleRecording` builds a `File`
  /// from the recorded blob and hands it to the very `setAttachment` its
  /// file input calls. Routing a note through the draft rather than straight
  /// to a send is what subjects it to every rule a picked file is subject to
  /// — the 25 MiB cap, the upload-on-send order, the draft surviving a
  /// failed upload, the send button's in-flight guard — instead of giving
  /// the microphone a private path where each of those has to be remembered
  /// again.
  ///
  /// Refusals need no handling here: `setDraft` puts its sentence on the
  /// controller, and `AttachmentDraftBar` is already listening.
  void _onVoiceRecorded(VoiceRecording note) {
    widget.attachments?.setDraft(pickedFromVoice(note));
    widget.onVoiceRecorded?.call(note);
  }

  /// The suggestion path, and the one rule that makes it safe.
  ///
  /// Note what is NOT consulted: the send button's own disabled state. That
  /// is also "the box is empty" — the exact state a chip is tapped in — and
  /// gating on it is what made every suggestion chip silently do nothing.
  /// [chipSubmitRefusal] is handed the four facts that actually decide, and
  /// the send button's state is not among them.
  ///
  /// Past the guard this is the SAME [_submit] a typed message takes, so a
  /// suggestion cannot slip past a rule typing is subject to.
  ChipSubmitRefusal? _submitSuggestionImpl(String text) {
    final ChipSubmitRefusal? refusal = chipSubmitRefusal(
      suggestion: text,
      draft: _controller.text,
      enabled: widget.enabled,
      // The SAME flag the send button reads. See `_uploading`.
      uploading: _uploading,
    );
    if (refusal != null) return refusal;
    _controller.text = text.trim();
    // A chip's caller gets its refusal synchronously and has nothing to do
    // with the send's future; `unawaited` says so rather than leaving
    // `unawaited_futures` to flag it.
    unawaited(_submit());
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final AttachmentDraftController? attachments = widget.attachments;
    // `composer.ts`: `input.value.trim() !== '' || pendingFile !== null`. A
    // photo with no caption still enables Send.
    final bool hasContent =
        _controller.text.trim().isNotEmpty || (attachments?.hasDraft ?? false);
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final bool affordances = _affordancesEnabled;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // Above the box, not over it: the composer sits at the bottom of the
        // screen, so a palette drawn downward would be off-screen — and one
        // drawn over the field would hide the caret the insertion lands at.
        if (_popover == _Popover.emoji)
          EmojiPopover(
            onSelect: _insert,
            onDismiss: () => _closePopover(_emojiButtonFocus),
          ),
        if (_popover == _Popover.link)
          LinkPopover(
            onInsert: (String url) {
              setState(() => _popover = _Popover.none);
              _insert(url);
            },
            onCancel: () => _closePopover(_linkButtonFocus),
          ),
        // Transient, like a palette: it exists only while the microphone is
        // open, so it stacks above the things that describe the message
        // itself.
        VoiceRecordingBar(controller: widget.voice),
        // What is attached right now — a sibling of the field, never inside
        // it, so a long file name cannot push the input around.
        if (attachments != null) AttachmentDraftBar(controller: attachments),
        // Directly above the box and below the popovers: the chip describes
        // what the NEXT send answers, so it belongs against the thing being
        // typed into, while a palette is transient and stacks over it.
        if (widget.replyTo != null)
          _ReplyChip(
            target: widget.replyTo!,
            onCancel: widget.onCancelReply,
          ),
        TextField(
          // Named because the link popover above brings a second field into
          // the same subtree while it is open, and "the message box" must
          // stay unambiguous for anything reaching in from outside.
          key: const Key('composer.message'),
          controller: _controller,
          focusNode: _focusNode,
          enabled: widget.enabled,
          minLines: 1,
          maxLines: 5,
          textInputAction: TextInputAction.send,
          onChanged: (_) => widget.onTyping?.call(),
          onSubmitted: (_) => _submit(),
          decoration: InputDecoration(
            hintText: 'Type a message…',
            isDense: true,
            filled: true,
            fillColor: scheme.surfaceContainerHighest,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(widget.radius),
              borderSide: BorderSide.none,
            ),
            // The reference's own order — attach, emoji, mic, link, send —
            // split across the two slots Flutter's decoration offers.
            prefixIcon: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (attachments != null)
                  AttachmentAttachButton(
                    controller: attachments,
                    enabled: widget.fileUploads,
                    composerEnabled: widget.enabled,
                  ),
                IconButton(
                  focusNode: _emojiButtonFocus,
                  tooltip: 'Insert an emoji',
                  icon: const Icon(Icons.emoji_emotions_outlined),
                  onPressed:
                      affordances ? () => _togglePopover(_Popover.emoji) : null,
                ),
              ],
            ),
            suffixIcon: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                VoiceRecordButton(
                  // Null when there is no draft controller, which draws no
                  // mic at all — the same "off, not broken" rule the
                  // paperclip follows. A voice note can only become a
                  // message by becoming a draft (see [_onVoiceRecorded]), so
                  // a microphone offered without one is a control that
                  // records into nothing.
                  controller: attachments == null ? null : widget.voice,
                  enabled: affordances,
                  onRecorded: _onVoiceRecorded,
                ),
                IconButton(
                  focusNode: _linkButtonFocus,
                  tooltip: 'Insert a link',
                  icon: const Icon(Icons.link),
                  onPressed:
                      affordances ? () => _togglePopover(_Popover.link) : null,
                ),
                IconButton(
                  tooltip: 'Send message',
                  icon: const Icon(Icons.send),
                  // `_uploading`, not `widget.uploading`: the send button and
                  // the chip guard read one flag.
                  onPressed: widget.enabled && !_uploading && hasContent
                      ? _submit
                      : null,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// The quoted message shown above the input while a reply is being composed.
///
/// ── Two stacked lines, and why not one ───────────────────────────────────
///
/// WHO on top, their words below. The reference's chip used to show a bare
/// excerpt behind the words "Replying to", which on a transcript with two
/// other parties — an agent and a bot — left the customer to guess whose
/// words they were about to quote. The name is the half that disambiguates,
/// so it gets its own line rather than a prefix.
///
/// Both strings are another participant's data and are rendered as TEXT,
/// never interpreted — the Flutter counterpart of the reference's
/// deliberate `textContent` on both nodes.
class _ReplyChip extends StatelessWidget {
  const _ReplyChip({required this.target, required this.onCancel});

  final ReplyTarget target;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;

    return Padding(
      key: const Key('composer.replyChip'),
      padding: const EdgeInsets.only(bottom: 4),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: <Widget>[
            // The quote bar every chat client draws down the left of a
            // quotation. Purely decorative, so it says nothing to a screen
            // reader.
            Container(
              width: 3,
              height: 34,
              margin: const EdgeInsets.only(left: 8, right: 8),
              decoration: BoxDecoration(
                color: scheme.primary,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                // One node, one sentence. Read as two unlabelled strings the
                // chip would announce a name and some words with no stated
                // relationship between them or to the box below.
                child: Semantics(
                  container: true,
                  excludeSemantics: true,
                  label: 'Replying to ${target.senderName}: ${target.excerpt}',
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        target.senderName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: scheme.primary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        target.excerpt,
                        // The excerpt is already collapsed to one line and
                        // capped by [ReplyTarget]; this is the visual
                        // backstop for a narrow screen, not a second cap.
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            IconButton(
              // Deliberately NOT gated on the composer being enabled: backing
              // out of a reply is how a customer undoes a mistaken tap, and a
              // gate that holds the box shut must not also trap them in a
              // reply they did not mean to start.
              tooltip: 'Cancel reply',
              iconSize: 18,
              visualDensity: VisualDensity.compact,
              onPressed: onCancel,
              icon: const Icon(Icons.close),
            ),
          ],
        ),
      ),
    );
  }
}
