import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

Finder _iconButton(String tooltip) => find.byWidgetPredicate(
      (Widget widget) => widget is IconButton && widget.tooltip == tooltip,
    );

Finder _emojiButton() => _iconButton('Insert an emoji');

void main() {
  testWidgets('uses a grey border until the message field is focused',
      (tester) async {
    final ThemeData theme = ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: theme,
        home: Scaffold(body: Composer(onSend: (_) {})),
      ),
    );

    BoxBorder border() {
      final Iterable<Container> containers =
          tester.widgetList<Container>(find.byType(Container));
      final Container box = containers.singleWhere(
        (Container container) =>
            container.decoration is BoxDecoration &&
            (container.decoration! as BoxDecoration).border is Border,
      );
      return (box.decoration! as BoxDecoration).border!;
    }

    expect((border() as Border).top.color, theme.colorScheme.outlineVariant);

    await tester.tap(find.byKey(const Key('composer.message')));
    await tester.pump();

    expect((border() as Border).top.color, theme.colorScheme.primary);
  });

  testWidgets('Send is disabled until there is non-blank content',
      (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));

    IconButton sendButton() =>
        tester.widget<IconButton>(_iconButton('Send message'));
    expect(sendButton().onPressed, isNull);

    await tester.enterText(find.byType(TextField), '   ');
    await tester.pump();
    expect(sendButton().onPressed, isNull,
        reason: 'whitespace-only is not real content');

    await tester.enterText(find.byType(TextField), 'Hello');
    await tester.pump();
    expect(sendButton().onPressed, isNotNull);
  });

  testWidgets('Send icon uses disabled colors when Send cannot be pressed',
      (tester) async {
    final ThemeData theme = ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: theme,
        home: Scaffold(body: Composer(onSend: (_) {})),
      ),
    );

    Color sendFill() {
      final DecoratedBox box = tester
          .widget<DecoratedBox>(find.byKey(const Key('composer.sendIcon')));
      return (box.decoration as BoxDecoration).color!;
    }

    expect(sendFill(), theme.colorScheme.onSurface.withAlpha(31));

    await tester.enterText(find.byType(TextField), 'Hello');
    await tester.pump();

    expect(sendFill(), theme.colorScheme.primary);
  });

  testWidgets(
      'tapping Send calls onSend with the trimmed text and clears the field',
      (tester) async {
    String? sent;
    await tester.pumpWidget(_wrap(Composer(onSend: (text) => sent = text)));

    await tester.enterText(find.byType(TextField), '  Hello there  ');
    await tester.pump();
    await tester.tap(_iconButton('Send message'));
    await tester.pump();

    expect(sent, 'Hello there');
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty);
  });

  testWidgets('submitting via the keyboard action also sends', (tester) async {
    String? sent;
    await tester.pumpWidget(_wrap(Composer(onSend: (text) => sent = text)));

    await tester.enterText(find.byType(TextField), 'Sent via enter');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();

    expect(sent, 'Sent via enter');
  });

  testWidgets('a blank submission via the keyboard action does nothing',
      (tester) async {
    String? sent;
    await tester.pumpWidget(_wrap(Composer(onSend: (text) => sent = text)));

    await tester.enterText(find.byType(TextField), '   ');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();

    expect(sent, isNull);
  });

  testWidgets(
      'the emoji sheet offers all 16 glyphs, and picking one inserts it',
      (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));

    await tester.enterText(find.byType(TextField), 'Hi ');
    await tester.tap(_emojiButton());
    await tester.pumpAndSettle();

    for (final emoji in kComposerEmoji) {
      expect(find.text(emoji), findsOneWidget,
          reason: 'missing $emoji in the sheet');
    }

    await tester.tap(find.text('👍'));
    await tester.pumpAndSettle();

    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Hi 👍');
  });

  testWidgets('inserts at the caret, not always at the end', (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));

    await tester.enterText(find.byType(TextField), 'Hi there');
    final controller =
        tester.widget<TextField>(find.byType(TextField)).controller!;
    // Caret after "Hi " (index 3), before "there".
    controller.selection = const TextSelection.collapsed(offset: 3);
    await tester.pump();

    await tester.tap(_emojiButton());
    await tester.pumpAndSettle();
    await tester.tap(find.text('👍'));
    await tester.pumpAndSettle();

    expect(controller.text, 'Hi 👍there');
  });

  testWidgets('enabled: false disables the field and both icon buttons',
      (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {}, enabled: false)));

    expect(tester.widget<TextField>(find.byType(TextField)).enabled, isFalse);
    expect(tester.widget<IconButton>(_emojiButton()).onPressed, isNull);
    expect(tester.widget<IconButton>(_iconButton('Send message')).onPressed,
        isNull);
  });

  // ── the suggestion chips ───────────────────────────────────────────────
  //
  // Reproduces `packages/widget/test/composer.test.ts:304-355` end to end,
  // through the composer rather than against the guard alone: the point is
  // that a chip and a typed message take the SAME submit, so a chip cannot
  // slip past a rule typing is subject to.
  group('submit(text) — the bot’s suggestion chips', () {
    Future<(ComposerController, List<String>)> mount(
      WidgetTester tester, {
      bool enabled = true,
      bool uploading = false,
    }) async {
      final ComposerController controller = ComposerController();
      final List<String> sent = <String>[];
      await tester.pumpWidget(_wrap(Composer(
        onSend: sent.add,
        controller: controller,
        enabled: enabled,
        uploading: uploading,
      )));
      return (controller, sent);
    }

    // THE headline. The bug this guards against: gating on the Send button's
    // disabled state refused every chip, because Send is disabled whenever
    // the box is empty — which is exactly the state a chip is tapped in.
    testWidgets('sends from an EMPTY box, the state a chip is tapped in',
        (tester) async {
      final (ComposerController controller, List<String> sent) =
          await mount(tester);

      // The premise: Send is disabled right now.
      expect(
        tester.widget<IconButton>(_iconButton('Send message')).onPressed,
        isNull,
      );

      expect(controller.submit('Check my account'), isNull);
      await tester.pump();

      expect(sent, <String>['Check my account']);
      // And the box is left as it was found.
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
    });

    testWidgets(
        'is a no-op while the composer is disabled — the consent gate '
        'holds', (tester) async {
      final (ComposerController controller, List<String> sent) =
          await mount(tester, enabled: false);

      expect(controller.submit('Check my account'),
          ChipSubmitRefusal.composerDisabled);
      await tester.pump();

      expect(sent, isEmpty);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
    });

    testWidgets('is a no-op while an upload is in flight', (tester) async {
      final (ComposerController controller, List<String> sent) =
          await mount(tester, uploading: true);

      expect(controller.submit('Check my account'),
          ChipSubmitRefusal.uploadInFlight);
      await tester.pump();

      expect(sent, isEmpty);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
    });

    testWidgets('refuses to overwrite a draft the customer is typing',
        (tester) async {
      final (ComposerController controller, List<String> sent) =
          await mount(tester);
      await tester.enterText(find.byType(TextField), 'my order was ');
      await tester.pump();

      expect(controller.submit('Check my account'),
          ChipSubmitRefusal.draftPresent);
      await tester.pump();

      expect(sent, isEmpty);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'my order was ',
      );
    });

    testWidgets('ignores a blank suggestion', (tester) async {
      final (ComposerController controller, List<String> sent) =
          await mount(tester);
      expect(controller.submit('   '), ChipSubmitRefusal.blankSuggestion);
      await tester.pump();
      expect(sent, isEmpty);
    });

    testWidgets('sends the suggestion trimmed, as a typed message would be',
        (tester) async {
      final (ComposerController controller, List<String> sent) =
          await mount(tester);
      controller.submit('  Check my account  ');
      await tester.pump();
      expect(sent, <String>['Check my account']);
    });

    testWidgets('goes dead when its composer leaves the tree', (tester) async {
      final (ComposerController controller, List<String> sent) =
          await mount(tester);
      await tester.pumpWidget(_wrap(const SizedBox()));

      expect(controller.submit('Check my account'),
          ChipSubmitRefusal.composerDisabled);
      expect(sent, isEmpty);
    });
  });

  // ── the emoji popover ──────────────────────────────────────────────────
  group('the emoji popover', () {
    testWidgets('opens in the widget’s own tree — no modal route, no sheet',
        (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      expect(find.byType(EmojiPopover), findsNothing);

      await tester.tap(_emojiButton());
      await tester.pumpAndSettle();

      expect(find.byType(EmojiPopover), findsOneWidget);
      // A bottom sheet would take focus off the box, hiding the very caret
      // the insertion is supposed to land at.
      expect(find.byType(BottomSheet), findsNothing);
    });

    // The sheet this replaced closed on every pick, making "👍🙏" two round
    // trips through the trigger.
    testWidgets('stays open across several picks', (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      await tester.tap(_emojiButton());
      await tester.pumpAndSettle();

      await tester.tap(find.text('👍'));
      await tester.pump();
      await tester.tap(find.text('🙏'));
      await tester.pump();

      expect(find.byType(EmojiPopover), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        '👍🙏',
      );
    });

    testWidgets('the trigger closes it again', (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      await tester.tap(_emojiButton());
      await tester.pumpAndSettle();
      await tester.tap(_emojiButton());
      await tester.pumpAndSettle();

      expect(find.byType(EmojiPopover), findsNothing);
    });

    // A dead trigger with an open popover leaves it unreachable and
    // unclosable by pointer.
    testWidgets(
        'closes rather than stranding itself when the composer is '
        'disabled while it is open', (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      await tester.tap(_emojiButton());
      await tester.pumpAndSettle();

      await tester.pumpWidget(_wrap(Composer(onSend: (_) {}, enabled: false)));
      await tester.pumpAndSettle();

      expect(find.byType(EmojiPopover), findsNothing);
    });

    testWidgets('closes rather than stranding itself when an upload starts',
        (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      await tester.tap(_emojiButton());
      await tester.pumpAndSettle();

      await tester.pumpWidget(_wrap(Composer(onSend: (_) {}, uploading: true)));
      await tester.pumpAndSettle();

      expect(find.byType(EmojiPopover), findsNothing);
    });
  });

  // ── the link popover ───────────────────────────────────────────────────
  group('the link popover', () {
    Finder linkButton() => _iconButton('Insert a link');
    const Key url = Key('composer.link.url');
    const Key insert = Key('composer.link.insert');

    testWidgets('opens in the widget, and closes after a valid insertion',
        (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      await tester.tap(linkButton());
      await tester.pumpAndSettle();
      expect(find.byType(LinkPopover), findsOneWidget);

      await tester.enterText(find.byKey(url), 'https://example.com/order/42');
      await tester.tap(find.byKey(insert));
      await tester.pumpAndSettle();

      expect(find.byType(LinkPopover), findsNothing);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'https://example.com/order/42',
      );
    });

    testWidgets('inserts at the caret, not at the end', (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      await tester.enterText(find.byType(TextField), 'See here: !');
      final TextEditingController field =
          tester.widget<TextField>(find.byType(TextField)).controller!;
      field.selection = const TextSelection.collapsed(offset: 10);
      await tester.pump();

      await tester.tap(linkButton());
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(url), 'https://x.test');
      await tester.tap(find.byKey(insert));
      await tester.pumpAndSettle();

      expect(field.text, 'See here: https://x.test!');
    });

    testWidgets('a rejection leaves the popover open with the value intact',
        (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      await tester.tap(linkButton());
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(url), 'javascript:alert(1)');
      await tester.tap(find.byKey(insert));
      await tester.pumpAndSettle();

      expect(find.byType(LinkPopover), findsOneWidget);
      expect(find.text(kLinkRejectionMessage), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byKey(url)).controller!.text,
        'javascript:alert(1)',
      );
      // And nothing reached the message box.
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('composer.message')))
            .controller!
            .text,
        isEmpty,
      );
    });

    testWidgets('opens fresh after a rejection was cancelled', (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      await tester.tap(linkButton());
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(url), 'foo');
      await tester.tap(find.byKey(insert));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('composer.link.cancel')));
      await tester.pumpAndSettle();

      await tester.tap(linkButton());
      await tester.pumpAndSettle();

      expect(
          tester.widget<TextField>(find.byKey(url)).controller!.text, isEmpty);
      expect(find.text(kLinkRejectionMessage), findsNothing);
    });

    testWidgets(
        'is disabled, and will not open, while the composer is '
        'disabled', (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {}, enabled: false)));
      expect(tester.widget<IconButton>(linkButton()).onPressed, isNull);
      expect(find.byType(LinkPopover), findsNothing);
    });

    testWidgets('is disabled while an upload is in flight', (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {}, uploading: true)));
      expect(tester.widget<IconButton>(linkButton()).onPressed, isNull);
    });
  });

  // ── the three effects every insertion has ──────────────────────────────
  //
  // See composer.dart's own library doc: skipping any one of these is a real
  // bug, not a missing polish step.
  group('an insertion has the same three effects a keystroke has', () {
    testWidgets('2. send-state sync — an emoji-only message can be sent',
        (tester) async {
      final List<String> sent = <String>[];
      await tester.pumpWidget(_wrap(Composer(onSend: sent.add)));

      IconButton send() =>
          tester.widget<IconButton>(_iconButton('Send message'));
      expect(send().onPressed, isNull, reason: 'the premise: an empty box');

      await tester.tap(_emojiButton());
      await tester.pumpAndSettle();
      await tester.tap(find.text('👍'));
      await tester.pumpAndSettle();

      // Without this effect the customer picks 👍 and Send stays dead.
      expect(send().onPressed, isNotNull);
      await tester.tap(_iconButton('Send message'));
      await tester.pump();
      expect(sent, <String>['👍']);
    });

    testWidgets(
        '3. onTyping — the agent is not told the customer stopped '
        'writing while they pick glyphs', (tester) async {
      int typing = 0;
      await tester.pumpWidget(
          _wrap(Composer(onSend: (_) {}, onTyping: () => typing++)));

      await tester.tap(_emojiButton());
      await tester.pumpAndSettle();
      await tester.tap(find.text('👍'));
      await tester.pump();
      expect(typing, 1);

      await tester.tap(find.text('🙏'));
      await tester.pump();
      expect(typing, 2);
    });

    testWidgets('3. onTyping fires for a link insertion too', (tester) async {
      int typing = 0;
      await tester.pumpWidget(
          _wrap(Composer(onSend: (_) {}, onTyping: () => typing++)));

      await tester.tap(_iconButton('Insert a link'));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const Key('composer.link.url')), 'https://x.test');
      await tester.tap(find.byKey(const Key('composer.link.insert')));
      await tester.pumpAndSettle();

      expect(typing, 1);
    });

    testWidgets('3. a REJECTED link is not a keystroke — nothing is announced',
        (tester) async {
      int typing = 0;
      await tester.pumpWidget(
          _wrap(Composer(onSend: (_) {}, onTyping: () => typing++)));

      await tester.tap(_iconButton('Insert a link'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('composer.link.url')), 'foo');
      await tester.tap(find.byKey(const Key('composer.link.insert')));
      await tester.pumpAndSettle();

      expect(typing, 0);
    });

    testWidgets(
        '1. autogrow — the box still declares the bounds it grows '
        'between', (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      final TextField field = tester.widget<TextField>(find.byType(TextField));
      // Autogrow is the framework's, driven by these two arguments. Deleting
      // them removes the effect silently, so they are pinned here.
      expect(field.minLines, 1);
      expect(field.maxLines, 5);
    });

    testWidgets(
        'focus returns to the message box, so the next keystroke '
        'lands in it', (tester) async {
      await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));
      await tester.tap(_emojiButton());
      await tester.pumpAndSettle();
      await tester.tap(find.text('👍'));
      await tester.pumpAndSettle();

      expect(
        tester.widget<TextField>(find.byType(TextField)).focusNode!.hasFocus,
        isTrue,
      );
    });
  });
}
