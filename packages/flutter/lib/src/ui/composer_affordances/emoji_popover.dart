/// The emoji shortcut: sixteen glyphs in a popover above the composer.
///
/// Ports `packages/widget/src/ui/emoji.ts`.
///
/// ── Why a fixed shortlist and not a keyboard ─────────────────────────────
///
/// Every platform already ships an emoji keyboard, reachable from the same
/// text field. What a support widget adds on top is a SHORTLIST — the
/// dozen-odd reactions that actually occur in a support thread — so this is a
/// shortcut, not a replacement. That framing is also what keeps it
/// affordable: a real picker means a searchable index of ~1900 glyphs plus
/// skin-tone variants, which is several times this widget's whole budget for
/// a feature nobody embeds a chat SDK to get. It is also why this module has
/// no package dependency: the palette is a `const` list of sixteen strings.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// The shortlist, 8x2 — identical set and order to `emoji.ts`'s `EMOJI`,
/// which has "already been through product review once".
///
/// The order is the contract, not just the contents: a customer who has used
/// one surface should find the same glyph in the same place in the other.
const List<String> kComposerEmoji = <String>[
  '👍', '🙏', '😊', '😕', '😡', '🎉', '❤️', '🔥', //
  '✅', '❌', '🍕', '📦', '🚚', '💳', '⏰', '❓',
];

/// Eight per row, so the sixteen sit as two tidy rows.
const int kEmojiGridColumns = 8;

/// An arrow, Home or End pressed while the grid has focus.
enum EmojiGridMove { left, right, up, down, first, last }

/// Where focus lands after [move], starting from cell [from].
///
/// **Wraps in both axes**, and that is a deliberate divergence from the CSAT
/// rating grid next door, which clamps. The two are not inconsistent — they
/// answer different questions about the cost of a keypress:
///
///   - Picking a glyph is harmless and reversible, so the cost of wrapping is
///     nil while the cost of a dead end is a customer holding an arrow key
///     and having to work out which key gets them moving again.
///   - Setting a rating is a claim about how the conversation went. Wrapping
///     from "Excellent" round to "Poor" would let ONE keypress set the exact
///     opposite of what was meant, so that grid stops at the ends.
///
/// Out-of-range input is normalised rather than thrown on: a stale index from
/// a rebuild should move focus somewhere sensible, not crash the composer.
int emojiGridTarget(int from, EmojiGridMove move) {
  final int length = kComposerEmoji.length;
  switch (move) {
    case EmojiGridMove.first:
      return 0;
    case EmojiGridMove.last:
      return length - 1;
    case EmojiGridMove.right:
      return _wrap(from + 1, length);
    case EmojiGridMove.left:
      return _wrap(from - 1, length);
    case EmojiGridMove.down:
      return _wrap(from + kEmojiGridColumns, length);
    case EmojiGridMove.up:
      return _wrap(from - kEmojiGridColumns, length);
  }
}

/// Dart's `%` already returns a non-negative result for a positive divisor,
/// so this is one step; the second `%` guards an index that arrived far out
/// of range rather than one step past an edge.
int _wrap(int index, int length) => ((index % length) + length) % length;

/// The `move` an arrow/Home/End key means, or `null` for every other key —
/// which must be left alone so a customer can still Tab out of the grid.
EmojiGridMove? emojiGridMoveForKey(LogicalKeyboardKey key) {
  if (key == LogicalKeyboardKey.arrowRight) return EmojiGridMove.right;
  if (key == LogicalKeyboardKey.arrowLeft) return EmojiGridMove.left;
  if (key == LogicalKeyboardKey.arrowDown) return EmojiGridMove.down;
  if (key == LogicalKeyboardKey.arrowUp) return EmojiGridMove.up;
  if (key == LogicalKeyboardKey.home) return EmojiGridMove.first;
  if (key == LogicalKeyboardKey.end) return EmojiGridMove.last;
  return null;
}

/// The palette itself, shown inline above the message box.
///
/// **Stays open after a pick**, which is the whole reason it is not a modal
/// sheet. A sheet closes on every selection, so "🎉🎉" is two round trips
/// through the trigger; worse, a modal takes focus off the message box, so
/// the caret the insertion is supposed to land at is not on screen while the
/// customer chooses. An inline popover keeps the field, its caret and the
/// palette visible at once — and [onSelect] is called once per tap, with the
/// popover still open, for as many glyphs as the customer wants.
class EmojiPopover extends StatefulWidget {
  const EmojiPopover({super.key, required this.onSelect, this.onDismiss});

  /// A glyph was picked. The popover stays open; inserting it and running the
  /// effects a keystroke has is the composer's job, not this widget's.
  final ValueChanged<String> onSelect;

  /// Escape was pressed. Absent means the popover cannot be dismissed from
  /// the keyboard, which is only correct where nothing can close it at all.
  final VoidCallback? onDismiss;

  @override
  State<EmojiPopover> createState() => _EmojiPopoverState();
}

class _EmojiPopoverState extends State<EmojiPopover> {
  /// One [FocusNode] per cell, because roving focus means moving REAL focus:
  /// a highlight that moves while focus does not is a lie to a screen reader.
  ///
  /// The handler is set on the node rather than on a wrapping [Focus] because
  /// key events travel UP from the node that holds focus — a `Focus` placed
  /// below the button's own node (around its label, say) would never see
  /// them.
  late final List<FocusNode> _nodes = <FocusNode>[
    for (int i = 0; i < kComposerEmoji.length; i++)
      FocusNode(debugLabel: 'emoji-${kComposerEmoji[i]}')
        ..onKeyEvent = (FocusNode _, KeyEvent event) => _onKey(i, event),
  ];

  @override
  void dispose() {
    for (final FocusNode node in _nodes) {
      node.dispose();
    }
    super.dispose();
  }

  KeyEventResult _onKey(int index, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      final VoidCallback? dismiss = widget.onDismiss;
      if (dismiss == null) return KeyEventResult.ignored;
      dismiss();
      // Handled, so it stops here: the panel around this widget has its own
      // Escape handler that closes the whole conversation, and an Escape
      // meant for the palette must not shut the chat instead.
      return KeyEventResult.handled;
    }
    final EmojiGridMove? move = emojiGridMoveForKey(event.logicalKey);
    if (move == null) return KeyEventResult.ignored;
    _nodes[emojiGridTarget(index, move)].requestFocus();
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return Semantics(
      container: true,
      label: 'Emoji',
      child: Focus(
        // The grid is ONE tab stop. Sixteen separate stops between the icon
        // row and the message box would make Tab unusable for a keyboard
        // customer who only wanted to reach somewhere else — so the cells stay
        // focusable (arrows move real focus between them) but are skipped by
        // traversal, which is the roving-tabindex rule the reference applies
        // with `tabindex="-1"`.
        descendantsAreTraversable: false,
        child: Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Wrap(
            alignment: WrapAlignment.center,
            children: <Widget>[
              for (int i = 0; i < kComposerEmoji.length; i++)
                _EmojiCell(
                  emoji: kComposerEmoji[i],
                  focusNode: _nodes[i],
                  onPressed: () => widget.onSelect(kComposerEmoji[i]),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmojiCell extends StatelessWidget {
  const _EmojiCell({
    required this.emoji,
    required this.focusNode,
    required this.onPressed,
  });

  final String emoji;
  final FocusNode focusNode;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      focusNode: focusNode,
      // The glyph IS the icon, so the button's own name is the only thing a
      // screen reader should read. Without [ExcludeSemantics] below it also
      // announces the glyph itself — "Insert 😊, grinning face".
      tooltip: 'Insert $emoji',
      onPressed: onPressed,
      icon: ExcludeSemantics(
        child: Text(emoji, style: const TextStyle(fontSize: 22)),
      ),
    );
  }
}
