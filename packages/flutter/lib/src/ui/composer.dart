/// The conversation composer: a text field with an emoji button inside its
/// own border and a send button — mirrors the reference's inline icon row
/// (`ui/composer.ts`'s `.dh-composer-row`, "image/emoji/attach/link... INSIDE
/// the input's border").
///
/// ── Why only emoji, and not attach/voice too ─────────────────────────────
///
/// `composer.ts` has all four; this does not, and that is deliberate, not an
/// oversight. Attachment upload and voice recording are BOTH out of scope in
/// `dhaam_chat` itself (packages/dart's own README: "Attachments upload —
/// Out of scope — inbound metadata decodes" / "Voice — Out of scope") — there
/// is no upload endpoint or microphone-capture path anywhere in this stack
/// for either to call. Shipping the buttons anyway would be exactly the
/// control this package's brief says never to ship: one wired to nothing.
/// Emoji has no such gap — inserting a glyph into a text field is entirely
/// client-side — so it is the one icon-row addition this pass makes.
///
/// ── A simpler emoji picker than `emoji.ts`'s ─────────────────────────────
///
/// The same 16-glyph shortlist, in the same order, for the reason `emoji.ts`
/// itself gives: "a customer who has used one surface should find the same
/// glyph in the same place in the other." What is NOT ported is that
/// picker's three UX refinements over ITS OWN baseline (stays open across
/// multiple picks, in particular) — those are real polish, but are a second
/// pass beyond what this task calls for. This one inserts at the caret and
/// returns focus to the field, then closes, which is the JS widget's own
/// starting point before those refinements were added.
library;

import 'package:flutter/material.dart';

/// The shortlist, 8x2 — identical set and order to `emoji.ts`'s `EMOJI`,
/// which has "already been through product review once".
const List<String> kComposerEmoji = <String>[
  '👍', '🙏', '😊', '😕', '😡', '🎉', '❤️', '🔥',
  '✅', '❌', '🍕', '📦', '🚚', '💳', '⏰', '❓',
];

class Composer extends StatefulWidget {
  const Composer({super.key, required this.onSend, this.radius = 24, this.enabled = true});

  /// The customer submitted [text] — already trimmed, always non-blank.
  final ValueChanged<String> onSend;
  final double radius;
  final bool enabled;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    // The send button's enabled state depends on the field's own content —
    // same reasoning composer.ts's syncSendState gives for re-checking on
    // every input event.
    _controller.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _insertEmoji(String emoji) {
    final TextSelection selection = _controller.selection;
    final String text = _controller.text;
    final int start = selection.start >= 0 ? selection.start : text.length;
    final int end = selection.end >= 0 ? selection.end : text.length;
    _controller.value = TextEditingValue(
      text: text.replaceRange(start, end, emoji),
      selection: TextSelection.collapsed(offset: start + emoji.length),
    );
    _focusNode.requestFocus();
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

  @override
  Widget build(BuildContext context) {
    final bool hasContent = _controller.text.trim().isNotEmpty;
    final ColorScheme scheme = Theme.of(context).colorScheme;

    return TextField(
      controller: _controller,
      focusNode: _focusNode,
      enabled: widget.enabled,
      minLines: 1,
      maxLines: 5,
      textInputAction: TextInputAction.send,
      onSubmitted: (_) => _submit(),
      decoration: InputDecoration(
        hintText: 'Type a message…',
        isDense: true,
        filled: true,
        fillColor: scheme.surfaceContainerHighest,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(widget.radius), borderSide: BorderSide.none),
        prefixIcon: IconButton(
          tooltip: 'Insert an emoji',
          icon: const Icon(Icons.emoji_emotions_outlined),
          onPressed: widget.enabled ? () => _pickEmoji(context) : null,
        ),
        suffixIcon: IconButton(
          tooltip: 'Send message',
          icon: const Icon(Icons.send),
          onPressed: widget.enabled && hasContent ? _submit : null,
        ),
      ),
    );
  }

  Future<void> _pickEmoji(BuildContext context) async {
    final String? picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext context) => const _EmojiSheet(),
    );
    if (picked != null) _insertEmoji(picked);
  }
}

class _EmojiSheet extends StatelessWidget {
  const _EmojiSheet();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      child: Wrap(
        alignment: WrapAlignment.center,
        children: <Widget>[
          for (final String emoji in kComposerEmoji)
            IconButton(
              onPressed: () => Navigator.of(context).pop(emoji),
              icon: Text(emoji, style: const TextStyle(fontSize: 22)),
            ),
        ],
      ),
    );
  }
}
