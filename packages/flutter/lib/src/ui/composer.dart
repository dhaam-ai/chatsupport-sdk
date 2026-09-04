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
/// ── Attach and voice are NOT here ────────────────────────────────────────
///
/// `composer.ts` has all four icons. Attachment picking and voice capture
/// land with their own nodes, which own the platform seams they need; this
/// file owns emoji, link, and the suggestion path. [uploading] is the one
/// fact this widget needs FROM the attachment side, and it is a plain
/// parameter rather than state owned here.
library;

import 'package:flutter/material.dart';

import 'composer_affordances/composer_affordances.dart';

class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.onSend,
    this.radius = 24,
    this.enabled = true,
    this.uploading = false,
    this.onTyping,
    this.controller,
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
  }

  @override
  void didUpdateWidget(Composer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.controller, widget.controller)) {
      oldWidget.controller?.detach(_submitSuggestion);
      widget.controller?.attach(_submitSuggestion);
    }
    // A disabled or uploading composer must not leave a popover open: its
    // trigger is dead in both states, so the popover would be unreachable and
    // unclosable by pointer. Same rule `composer.ts`'s syncSendState applies.
    if (!_affordancesEnabled && _popover != _Popover.none) {
      _popover = _Popover.none;
    }
  }

  @override
  void dispose() {
    widget.controller?.detach(_submitSuggestion);
    _controller.dispose();
    _focusNode.dispose();
    _emojiButtonFocus.dispose();
    _linkButtonFocus.dispose();
    super.dispose();
  }

  bool get _affordancesEnabled => widget.enabled && !widget.uploading;

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

  void _submit() {
    final String text = _controller.text.trim();
    if (text.isEmpty) return;
    // Cleared optimistically, before the send even resolves: dhaam_chat's
    // ChatClient marks an unreachable send failed rather than losing it
    // (see its own class doc), so re-showing the text would only invite a
    // duplicate send — same reasoning composer.ts's own submit() gives.
    _controller.clear();
    widget.onSend(text);
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
      uploading: widget.uploading,
    );
    if (refusal != null) return refusal;
    _controller.text = text.trim();
    _submit();
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final bool hasContent = _controller.text.trim().isNotEmpty;
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
            prefixIcon: IconButton(
              focusNode: _emojiButtonFocus,
              tooltip: 'Insert an emoji',
              icon: const Icon(Icons.emoji_emotions_outlined),
              onPressed:
                  affordances ? () => _togglePopover(_Popover.emoji) : null,
            ),
            suffixIcon: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
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
                  onPressed:
                      widget.enabled && !widget.uploading && hasContent
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
