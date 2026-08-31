import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('Send is disabled until there is non-blank content', (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));

    IconButton sendButton() => tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.send));
    expect(sendButton().onPressed, isNull);

    await tester.enterText(find.byType(TextField), '   ');
    await tester.pump();
    expect(sendButton().onPressed, isNull, reason: 'whitespace-only is not real content');

    await tester.enterText(find.byType(TextField), 'Hello');
    await tester.pump();
    expect(sendButton().onPressed, isNotNull);
  });

  testWidgets('tapping Send calls onSend with the trimmed text and clears the field', (tester) async {
    String? sent;
    await tester.pumpWidget(_wrap(Composer(onSend: (text) => sent = text)));

    await tester.enterText(find.byType(TextField), '  Hello there  ');
    await tester.pump();
    await tester.tap(find.widgetWithIcon(IconButton, Icons.send));
    await tester.pump();

    expect(sent, 'Hello there');
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
  });

  testWidgets('submitting via the keyboard action also sends', (tester) async {
    String? sent;
    await tester.pumpWidget(_wrap(Composer(onSend: (text) => sent = text)));

    await tester.enterText(find.byType(TextField), 'Sent via enter');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();

    expect(sent, 'Sent via enter');
  });

  testWidgets('a blank submission via the keyboard action does nothing', (tester) async {
    String? sent;
    await tester.pumpWidget(_wrap(Composer(onSend: (text) => sent = text)));

    await tester.enterText(find.byType(TextField), '   ');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();

    expect(sent, isNull);
  });

  testWidgets('the emoji sheet offers all 16 glyphs, and picking one inserts it', (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));

    await tester.enterText(find.byType(TextField), 'Hi ');
    await tester.tap(find.widgetWithIcon(IconButton, Icons.emoji_emotions_outlined));
    await tester.pumpAndSettle();

    for (final emoji in kComposerEmoji) {
      expect(find.text(emoji), findsOneWidget, reason: 'missing $emoji in the sheet');
    }

    await tester.tap(find.text('👍'));
    await tester.pumpAndSettle();

    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'Hi 👍');
  });

  testWidgets('inserts at the caret, not always at the end', (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));

    await tester.enterText(find.byType(TextField), 'Hi there');
    final controller = tester.widget<TextField>(find.byType(TextField)).controller!;
    // Caret after "Hi " (index 3), before "there".
    controller.selection = const TextSelection.collapsed(offset: 3);
    await tester.pump();

    await tester.tap(find.widgetWithIcon(IconButton, Icons.emoji_emotions_outlined));
    await tester.pumpAndSettle();
    await tester.tap(find.text('👍'));
    await tester.pumpAndSettle();

    expect(controller.text, 'Hi 👍there');
  });

  testWidgets('enabled: false disables the field and both icon buttons', (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {}, enabled: false)));

    expect(tester.widget<TextField>(find.byType(TextField)).enabled, isFalse);
    expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.emoji_emotions_outlined)).onPressed, isNull);
    expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.send)).onPressed, isNull);
  });
}
