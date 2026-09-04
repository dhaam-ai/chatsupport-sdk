import 'package:dhaam_chat/dhaam_chat.dart' show safeLinkUrl;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reproduces the link-popover block of
/// `packages/widget/test/composer.test.ts:92-300`, minus the assertions that
/// are about the composer mounting and unmounting it (those live in
/// `composer_test.dart`).
void main() {
  const Key url = Key('composer.link.url');
  const Key insert = Key('composer.link.insert');
  const Key cancel = Key('composer.link.cancel');

  Future<(List<String>, int)> mount(WidgetTester tester) async {
    final List<String> inserted = <String>[];
    int cancelled = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LinkPopover(
            onInsert: inserted.add,
            onCancel: () => cancelled++,
          ),
        ),
      ),
    );
    await tester.pump();
    return (inserted, cancelled);
  }

  testWidgets('is a widget in the composer’s own tree, not a dialog route',
      (WidgetTester tester) async {
    const Key host = Key('the-composer');
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Column(
            key: host,
            children: <Widget>[LinkPopover(onInsert: (_) {})],
          ),
        ),
      ),
    );

    // It renders WHERE IT WAS PUT. A `showDialog`, an `AlertDialog` or a
    // platform alert would render in an overlay above this subtree instead —
    // unthemed by the merchant's colours and, on a host that suppresses
    // modals, not at all.
    expect(
      find.descendant(of: find.byKey(host), matching: find.byType(LinkPopover)),
      findsOneWidget,
    );
    expect(find.byType(Dialog), findsNothing);
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('focuses the URL field, because that is what it is for',
      (WidgetTester tester) async {
    await mount(tester);
    expect(
      tester.widget<TextField>(find.byKey(url)).focusNode!.hasFocus,
      isTrue,
    );
  });

  testWidgets('inserts a URL that safeLinkUrl accepts',
      (WidgetTester tester) async {
    final (List<String> inserted, _) = await mount(tester);

    await tester.enterText(find.byKey(url), 'https://example.com/order/42');
    await tester.tap(find.byKey(insert));
    await tester.pump();

    expect(inserted, <String>['https://example.com/order/42']);
  });

  testWidgets('trims, exactly as safeLinkUrl does — one validator, one answer',
      (WidgetTester tester) async {
    final (List<String> inserted, _) = await mount(tester);

    await tester.enterText(find.byKey(url), '  https://x.test  ');
    await tester.tap(find.byKey(insert));
    await tester.pump();

    expect(inserted, <String>[safeLinkUrl('  https://x.test  ')!]);
    expect(inserted, <String>['https://x.test']);
  });

  // The headline of this widget's own contract: a typo is CORRECTED, not
  // retyped.
  for (final String rejected in <String>[
    'javascript:alert(1)',
    'foo',
    'data:text/html,<script>alert(1)</script>',
    'htps://example.com',
    '',
  ]) {
    testWidgets(
        'rejects ${rejected.isEmpty ? "an empty field" : rejected} '
        'and stays open with the value intact', (WidgetTester tester) async {
      final (List<String> inserted, _) = await mount(tester);

      await tester.enterText(find.byKey(url), rejected);
      await tester.tap(find.byKey(insert));
      await tester.pump();

      expect(inserted, isEmpty);
      expect(find.byType(LinkPopover), findsOneWidget, reason: 'stays open');
      expect(find.text(kLinkRejectionMessage), findsOneWidget);
      // Left in place to be corrected, with focus still on it.
      expect(
          tester.widget<TextField>(find.byKey(url)).controller!.text, rejected);
      expect(
        tester.widget<TextField>(find.byKey(url)).focusNode!.hasFocus,
        isTrue,
      );
    });
  }

  testWidgets(
      'safeLinkUrl is the ONE validator — nothing here second-guesses '
      'it', (WidgetTester tester) async {
    final (List<String> inserted, _) = await mount(tester);
    // A shape the browser's own type="url" check passes and safeLinkUrl
    // refuses. If a second validator ever appears, this is where the two
    // answers diverge.
    const String platformWouldAccept = 'ftp://files.example.com/receipt.pdf';
    expect(safeLinkUrl(platformWouldAccept), isNull, reason: 'the premise');

    await tester.enterText(find.byKey(url), platformWouldAccept);
    await tester.tap(find.byKey(insert));
    await tester.pump();

    expect(inserted, isEmpty);
  });

  testWidgets('a corrected typo goes through on the second attempt',
      (WidgetTester tester) async {
    final (List<String> inserted, _) = await mount(tester);

    await tester.enterText(find.byKey(url), 'htps://x.test');
    await tester.tap(find.byKey(insert));
    await tester.pump();
    expect(find.text(kLinkRejectionMessage), findsOneWidget);

    await tester.enterText(find.byKey(url), 'https://x.test');
    await tester.tap(find.byKey(insert));
    await tester.pump();

    expect(inserted, <String>['https://x.test']);
  });

  testWidgets('the keyboard action submits, same as the Insert button',
      (WidgetTester tester) async {
    final (List<String> inserted, _) = await mount(tester);

    await tester.enterText(find.byKey(url), 'https://x.test');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    expect(inserted, <String>['https://x.test']);
  });

  testWidgets('Cancel closes without inserting', (WidgetTester tester) async {
    int cancelled = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LinkPopover(
            onInsert: (_) => fail('nothing should be inserted'),
            onCancel: () => cancelled++,
          ),
        ),
      ),
    );

    await tester.enterText(find.byKey(url), 'https://x.test');
    await tester.tap(find.byKey(cancel));
    await tester.pump();

    expect(cancelled, 1);
  });

  testWidgets('Escape cancels, and does not reach the panel behind it',
      (WidgetTester tester) async {
    int cancelled = 0;
    int reachedPanel = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Focus(
            onKeyEvent: (FocusNode _, KeyEvent event) {
              if (event is KeyDownEvent &&
                  event.logicalKey == LogicalKeyboardKey.escape) {
                reachedPanel++;
              }
              return KeyEventResult.ignored;
            },
            child: LinkPopover(
              onInsert: (_) {},
              onCancel: () => cancelled++,
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();

    expect(cancelled, 1);
    // The panel closes the whole conversation on Escape.
    expect(reachedPanel, 0);
  });
}
