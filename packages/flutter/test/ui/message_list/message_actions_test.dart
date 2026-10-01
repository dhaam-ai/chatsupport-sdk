// Reproduces `message-actions.ts`'s contract and the transferable half of
// `outside-dismiss-retargeting.test.ts`.
//
// The DOM half does not transfer: there is no shadow root here, so nothing
// retargets a press to a host and `composedPath()[0]` has no counterpart.
// What that test actually GUARDS does transfer, and is asserted below — a
// press on a menu item must not dismiss the menu before its tap lands, and
// a press outside must dismiss it.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: Center(
        child: Row(
          children: <Widget>[
            const SizedBox(width: 120, height: 120, child: Text('outside')),
            child,
          ],
        ),
      ),
    ),
  );
}

void main() {
  group('MessageActionsController', () {
    test('copy swaps the label in place and auto-closes after 1200 ms',
        () async {
      final MessageActionsController controller = MessageActionsController();
      addTearDown(controller.dispose);
      controller.open();

      await controller.copy(() async {});
      expect(controller.copyLabel, kCopiedLabel);
      expect(controller.announcement, kCopiedLabel);
      // The confirmation IS the label swap, so the menu stays open to show it.
      expect(controller.isOpen, isTrue);
      expect(kCopyOutcomeDuration, const Duration(milliseconds: 1200));
    });

    test('a refused clipboard says so rather than doing nothing visible',
        () async {
      final MessageActionsController controller = MessageActionsController();
      addTearDown(controller.dispose);
      controller.open();

      await controller.copy(() async => throw StateError('refused'));
      expect(controller.copyLabel, kCopyFailedLabel);
      expect(controller.announcement, kCopyFailedLabel);
    });

    test('closing while the outcome shows restores a plain Copy', () {
      final MessageActionsController controller = MessageActionsController();
      addTearDown(controller.dispose);
      controller.open();
      controller.close();
      // A menu re-opened later must not still say "Copied" about a different
      // moment.
      expect(controller.copyLabel, 'Copy');
      expect(controller.isCopyBusy, isFalse);
    });

    test(
        'a menu closed while the clipboard was pending skips the VISUAL '
        'outcome and lets only the announcement stand', () async {
      final MessageActionsController controller = MessageActionsController();
      addTearDown(controller.dispose);
      controller.open();

      // An outside press or Escape lands while the future is still pending.
      final Future<void> pending = controller.copy(() async {
        controller.close();
      });
      await pending;

      expect(controller.isOpen, isFalse);
      // Swapping the label now would strand "Copied" on a closed menu for
      // the next open to show about a different moment.
      expect(controller.copyLabel, 'Copy');
      // The announcement still stands — it is the only feedback a screen
      // reader whose focus moved on would ever get.
      expect(controller.announcement, kCopiedLabel);
    });

    test('a second press during the outcome is ignored', () async {
      int calls = 0;
      final MessageActionsController controller = MessageActionsController();
      addTearDown(controller.dispose);
      controller.open();

      await controller.copy(() async => calls += 1);
      await controller.copy(() async => calls += 1);
      expect(calls, 1);
    });
  });

  group('MessageActions', () {
    testWidgets('offers exactly Copy and Reply — no edit, no delete',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(
          MessageActions(onCopy: () async {}, onReply: () {}),
        ),
      );
      await tester.tap(find.byIcon(Icons.more_horiz));
      await tester.pumpAndSettle();

      expect(find.text('Copy'), findsOneWidget);
      expect(find.text('Reply'), findsOneWidget);
      // There is no `message.edit` or `message.delete` frame; a menu item
      // that cannot work is worse than an absent one.
      expect(find.text('Edit'), findsNothing);
      expect(find.text('Delete'), findsNothing);
      // Exactly two items, not two plus something inert.
      expect(
        find.byWidgetPredicate((Widget widget) => widget is TextButton),
        findsNWidgets(2),
      );
      expect(find.byIcon(Icons.copy_rounded), findsOneWidget);
      expect(find.byIcon(Icons.reply_rounded), findsOneWidget);
    });

    testWidgets('a press on a menu item does NOT close it, so its tap lands',
        (WidgetTester tester) async {
      int replies = 0;
      await tester.pumpWidget(
        _wrap(
          MessageActions(onCopy: () async {}, onReply: () => replies += 1),
        ),
      );
      await tester.tap(find.byIcon(Icons.more_horiz));
      await tester.pumpAndSettle();

      // Reply, not Copy: its handler is synchronous, so the tap landing is
      // observable without waiting out the copy-outcome timer.
      final TestGesture gesture =
          await tester.startGesture(tester.getCenter(find.text('Reply')));
      await tester.pump();
      // Still open at "release" time — the tap this press produces can land.
      expect(find.text('Reply'), findsOneWidget);

      await gesture.up();
      await tester.pumpAndSettle();
      expect(replies, 1);
      expect(find.text('Reply'), findsNothing);
    });

    testWidgets('a press outside closes it', (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(MessageActions(onCopy: () async {}, onReply: () {})),
      );
      await tester.tap(find.byIcon(Icons.more_horiz));
      await tester.pumpAndSettle();
      expect(find.text('Copy'), findsOneWidget);

      await tester.tapAt(tester.getCenter(find.text('outside')));
      await tester.pumpAndSettle();
      expect(find.text('Copy'), findsNothing);
    });

    testWidgets('Copy swaps its label then closes itself after 1200 ms',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(MessageActions(onCopy: () async {}, onReply: () {})),
      );
      await tester.tap(find.byIcon(Icons.more_horiz));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Copy'));
      await tester.pump();
      await tester.pump();
      expect(find.text(kCopiedLabel), findsOneWidget);

      await tester.pump(kCopyOutcomeDuration);
      await tester.pumpAndSettle();
      expect(find.text(kCopiedLabel), findsNothing);
      expect(find.text('Copy'), findsNothing);
    });

    testWidgets('Escape closes the menu and returns focus to the toggle',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(MessageActions(onCopy: () async {}, onReply: () {})),
      );
      await tester.tap(find.byIcon(Icons.more_horiz));
      await tester.pumpAndSettle();

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.text('Copy'), findsNothing);

      // Focus back where the customer left it, so Escape does not strand a
      // keyboard user at the top of the document.
      final Element toggle = tester.element(find.byIcon(Icons.more_horiz));
      expect(Focus.of(toggle, scopeOk: true).hasFocus, isTrue);
    });
  });
}
