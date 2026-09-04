import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reproduces `packages/widget/test/emoji.test.ts:77-254` — the picker half.
/// The DOM-shaped assertions (`hidden`, `aria-expanded`, document-level
/// listeners) belong to the composer that mounts and unmounts this widget and
/// are asserted in `composer_test.dart`; what is here is the grid itself.
void main() {
  FocusNode cellFocus(WidgetTester tester, String emoji) => tester
      .widget<IconButton>(
        find.ancestor(of: find.text(emoji), matching: find.byType(IconButton)),
      )
      .focusNode!;

  Future<void> mount(
    WidgetTester tester, {
    required ValueChanged<String> onSelect,
    VoidCallback? onDismiss,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: EmojiPopover(onSelect: onSelect, onDismiss: onDismiss),
        ),
      ),
    );
  }

  group('the shortlist', () {
    test('is the same 16 glyphs, in the same order, as emoji.ts', () {
      expect(kComposerEmoji, hasLength(16));
      expect(kComposerEmoji.first, '👍');
      expect(kComposerEmoji[5], '🎉');
      expect(kComposerEmoji.last, '❓');
      expect(kComposerEmoji.toSet(), hasLength(16), reason: 'no duplicates');
    });

    test('is laid out 8 across, so the sixteen are two rows', () {
      expect(kEmojiGridColumns, 8);
      expect(kComposerEmoji.length % kEmojiGridColumns, 0);
    });

    testWidgets('renders every glyph as its own control',
        (WidgetTester tester) async {
      await mount(tester, onSelect: (_) {});
      for (final String emoji in kComposerEmoji) {
        expect(find.text(emoji), findsOneWidget, reason: 'missing $emoji');
      }
    });

    testWidgets('gives every cell a distinct accessible name',
        (WidgetTester tester) async {
      await mount(tester, onSelect: (_) {});
      final Set<String?> names = tester
          .widgetList<IconButton>(find.byType(IconButton))
          .map((IconButton button) => button.tooltip)
          .toSet();
      expect(names, hasLength(16));
      expect(names, contains('Insert 👍'));
    });
  });

  group('emojiGridTarget — arrows wrap in BOTH axes', () {
    // Deliberately unlike the CSAT rating grid, which clamps: picking a glyph
    // is harmless, while one keypress setting the opposite rating is not.
    const Map<String, (int, EmojiGridMove, int)> moves =
        <String, (int, EmojiGridMove, int)>{
      'right, 0 to 1': (0, EmojiGridMove.right, 1),
      'left, 1 to 0': (1, EmojiGridMove.left, 0),
      'down, 0 to 8': (0, EmojiGridMove.down, 8),
      'up, 8 to 0': (8, EmojiGridMove.up, 0),
      'end, 0 to 15': (0, EmojiGridMove.last, 15),
      'home, 5 to 0': (5, EmojiGridMove.first, 0),
      'right WRAPS, 15 to 0': (15, EmojiGridMove.right, 0),
      'left WRAPS, 0 to 15': (0, EmojiGridMove.left, 15),
      'down WRAPS, 8 to 0': (8, EmojiGridMove.down, 0),
      'up WRAPS, 0 to 8': (0, EmojiGridMove.up, 8),
    };

    moves.forEach((String name, (int, EmojiGridMove, int) each) {
      test(name, () => expect(emojiGridTarget(each.$1, each.$2), each.$3));
    });

    test('no move ever lands outside the grid, from any cell', () {
      for (int from = 0; from < kComposerEmoji.length; from++) {
        for (final EmojiGridMove move in EmojiGridMove.values) {
          expect(
            emojiGridTarget(from, move),
            inInclusiveRange(0, kComposerEmoji.length - 1),
            reason: '$move from $from',
          );
        }
      }
    });

    test('normalises a stale index rather than crashing the composer', () {
      expect(emojiGridTarget(99, EmojiGridMove.right), isNotNull);
      expect(emojiGridTarget(-40, EmojiGridMove.left),
          inInclusiveRange(0, kComposerEmoji.length - 1));
    });

    test('maps the six keys that move, and leaves every other key alone', () {
      expect(emojiGridMoveForKey(LogicalKeyboardKey.arrowRight),
          EmojiGridMove.right);
      expect(emojiGridMoveForKey(LogicalKeyboardKey.arrowLeft),
          EmojiGridMove.left);
      expect(emojiGridMoveForKey(LogicalKeyboardKey.arrowDown),
          EmojiGridMove.down);
      expect(emojiGridMoveForKey(LogicalKeyboardKey.arrowUp), EmojiGridMove.up);
      expect(emojiGridMoveForKey(LogicalKeyboardKey.home), EmojiGridMove.first);
      expect(emojiGridMoveForKey(LogicalKeyboardKey.end), EmojiGridMove.last);
      // Tab must reach traversal, not be eaten as a move.
      expect(emojiGridMoveForKey(LogicalKeyboardKey.tab), isNull);
      expect(emojiGridMoveForKey(LogicalKeyboardKey.enter), isNull);
    });
  });

  group('roving focus — the grid is one tab stop, arrows move within it', () {
    testWidgets('an arrow moves REAL focus, not just a highlight',
        (WidgetTester tester) async {
      await mount(tester, onSelect: (_) {});
      cellFocus(tester, '👍').requestFocus();
      await tester.pump();

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pump();

      expect(cellFocus(tester, '🙏').hasFocus, isTrue);
      expect(cellFocus(tester, '👍').hasFocus, isFalse);
    });

    testWidgets('ArrowLeft from the first cell wraps to the last',
        (WidgetTester tester) async {
      await mount(tester, onSelect: (_) {});
      cellFocus(tester, '👍').requestFocus();
      await tester.pump();

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
      await tester.pump();

      expect(cellFocus(tester, '❓').hasFocus, isTrue);
    });

    testWidgets('ArrowDown from the bottom row wraps to the top',
        (WidgetTester tester) async {
      await mount(tester, onSelect: (_) {});
      cellFocus(tester, '✅').requestFocus(); // index 8, bottom-left
      await tester.pump();

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pump();

      expect(cellFocus(tester, '👍').hasFocus, isTrue);
    });

    // Sixteen separate tab stops between the icon row and the message box
    // would make Tab unusable for a keyboard customer heading elsewhere.
    testWidgets('Tab leaves the grid rather than walking all sixteen cells',
        (WidgetTester tester) async {
      await mount(tester, onSelect: (_) {});
      cellFocus(tester, '👍').requestFocus();
      await tester.pump();

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();

      final Set<FocusNode> cells = <FocusNode>{
        for (final String emoji in kComposerEmoji) cellFocus(tester, emoji),
      };
      expect(cells.contains(primaryFocus), isFalse);
    });
  });

  group('picking', () {
    testWidgets('reports a pick to the caller', (WidgetTester tester) async {
      final List<String> picked = <String>[];
      await mount(tester, onSelect: picked.add);

      await tester.tap(find.text('🎉'));
      await tester.pump();

      expect(picked, <String>['🎉']);
    });

    // The bottom sheet this replaced closed after every insertion, making
    // "👍🙏" two round trips through the trigger.
    testWidgets('stays open so several can be inserted in a row',
        (WidgetTester tester) async {
      final List<String> picked = <String>[];
      await mount(tester, onSelect: picked.add);

      await tester.tap(find.text('👍'));
      await tester.pump();
      await tester.tap(find.text('🙏'));
      await tester.pump();

      expect(picked, <String>['👍', '🙏']);
      expect(find.byType(EmojiPopover), findsOneWidget);
    });
  });

  group('Escape', () {
    testWidgets('dismisses, and does not reach the panel behind it',
        (WidgetTester tester) async {
      int dismissed = 0;
      int reachedPanel = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Focus(
              onKeyEvent: (FocusNode _, KeyEvent event) {
                // Key-DOWN only, which is what a panel's own Escape handler
                // acts on; counting the key-up as well would fail this on an
                // event nobody dismisses anything from.
                if (event is KeyDownEvent &&
                    event.logicalKey == LogicalKeyboardKey.escape) {
                  reachedPanel++;
                }
                return KeyEventResult.ignored;
              },
              child: EmojiPopover(
                onSelect: (_) {},
                onDismiss: () => dismissed++,
              ),
            ),
          ),
        ),
      );
      cellFocus(tester, '👍').requestFocus();
      await tester.pump();

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();

      expect(dismissed, 1);
      // The panel around the composer closes the whole conversation on
      // Escape. An Escape meant for the palette must not shut the chat.
      expect(reachedPanel, 0);
    });
  });
}
