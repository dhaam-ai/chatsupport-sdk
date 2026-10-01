// The composer's reply chip — the half of `composer.ts`'s `setReplyTo` that
// the customer can actually see and back out of.
//
// The chip is drawn from a target it does not own, so these tests hand it one
// as a parameter and assert only what it renders and what it reports. Whether
// the target survives lives in test/state/reply_target_state_test.dart, and
// whether a send consumes it lives in the conversation-screen test — three
// files because they are three different claims.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

ChatMessage _message({String id = 'm1', String content = 'Hello there'}) =>
    ChatMessage(
      id: id,
      sessionId: 's1',
      senderId: 'agent-1',
      senderType: SenderType.agent,
      type: MessageType.text,
      content: content,
      seq: 1,
      createdAt: DateTime.utc(2026, 1, 1),
      delivery: MessageDelivery.confirmed,
    );

ReplyTarget _target({String id = 'm1', String content = 'Hello there'}) =>
    ReplyTarget.from(_message(id: id, content: content), senderName: 'Alex');

final Finder _chip = find.byKey(const Key('composer.replyChip'));
final Finder _cancel = find.widgetWithIcon(IconButton, Icons.close);

void main() {
  testWidgets('no chip at all when nothing is being replied to',
      (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));

    expect(_chip, findsNothing);
  });

  testWidgets('the chip names WHO is being answered as well as what they said',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        Composer(
          onSend: (_) {},
          replyTo: _target(),
          onCancelReply: () {},
        ),
      ),
    );

    expect(_chip, findsOneWidget);
    // Both lines. On a transcript with an agent AND a bot, an excerpt alone
    // leaves the customer guessing whose words they are about to quote.
    expect(find.text('Alex'), findsOneWidget);
    expect(find.text('Hello there'), findsOneWidget);
  });

  testWidgets('the dismiss control is reachable and reports the cancel',
      (tester) async {
    int cancels = 0;
    await tester.pumpWidget(
      _wrap(
        Composer(
          onSend: (_) {},
          replyTo: _target(),
          onCancelReply: () => cancels += 1,
        ),
      ),
    );

    await tester.tap(_cancel);
    await tester.pump();

    // A customer who taps Reply by mistake must be able to back out.
    expect(cancels, 1);
  });

  testWidgets('the dismiss control is labelled for a screen reader',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        Composer(
          onSend: (_) {},
          replyTo: _target(),
          onCancelReply: () {},
        ),
      ),
    );

    // A bare ✕ on a chip announces as an unlabelled button.
    expect(find.byTooltip('Cancel reply'), findsOneWidget);
  });

  testWidgets('the chip reads as one sentence, not two loose strings',
      (tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(
      _wrap(
        Composer(
          onSend: (_) {},
          replyTo: _target(),
          onCancelReply: () {},
        ),
      ),
    );

    expect(
      find.bySemanticsLabel('Replying to Alex: Hello there'),
      findsOneWidget,
    );
    handle.dispose();
  });

  testWidgets('clearing the target takes the chip away', (tester) async {
    await tester.pumpWidget(
      _wrap(
        Composer(onSend: (_) {}, replyTo: _target(), onCancelReply: () {}),
      ),
    );
    expect(_chip, findsOneWidget);

    await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));

    expect(_chip, findsNothing);
  });

  testWidgets('a reply still sends through the ordinary submit path',
      (tester) async {
    String? sent;
    await tester.pumpWidget(
      _wrap(
        Composer(
          onSend: (String text) => sent = text,
          replyTo: _target(),
          onCancelReply: () {},
        ),
      ),
    );

    await tester.enterText(find.byKey(const Key('composer.message')), 'Yes');
    await tester.pump();
    await tester.tap(find.widgetWithIcon(IconButton, Icons.send));
    await tester.pump();

    // `onSend` carries TEXT and nothing else. The reply id cannot travel back
    // out of this widget, which is what keeps a reply on the same path — and
    // therefore subject to the same consent gate — as a typed message.
    expect(sent, 'Yes');
  });

  testWidgets('a new target puts the caret in the box', (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {})));

    FocusNode boxFocus() => tester
        .widget<TextField>(find.byKey(const Key('composer.message')))
        .focusNode!;
    expect(boxFocus().hasFocus, isFalse);

    await tester.pumpWidget(
      _wrap(
        Composer(onSend: (_) {}, replyTo: _target(), onCancelReply: () {}),
      ),
    );
    await tester.pump();

    // The customer pressed Reply in a menu halfway up the transcript. Landing
    // them on the box is the difference between one gesture and two.
    expect(boxFocus().hasFocus, isTrue);
  });

  testWidgets(
      'an unrelated rebuild carrying the same target does not steal '
      'focus back', (tester) async {
    await tester.pumpWidget(
      _wrap(
        Composer(onSend: (_) {}, replyTo: _target(), onCancelReply: () {}),
      ),
    );
    await tester.pump();

    final FocusNode elsewhere = FocusNode();
    addTearDown(elsewhere.dispose);

    await tester.pumpWidget(
      _wrap(
        Column(
          children: <Widget>[
            Focus(focusNode: elsewhere, child: const SizedBox(height: 10)),
            Composer(
              onSend: (_) {},
              // A DIFFERENT instance holding the same values. ReplyTarget
              // compares by value, so this must not read as a new reply.
              replyTo: _target(),
              onCancelReply: () {},
            ),
          ],
        ),
      ),
    );
    elsewhere.requestFocus();
    await tester.pump();

    await tester.pumpWidget(
      _wrap(
        Column(
          children: <Widget>[
            Focus(focusNode: elsewhere, child: const SizedBox(height: 10)),
            Composer(
              onSend: (_) {},
              replyTo: _target(),
              onCancelReply: () {},
              // Something else about the composer changed; the target did not.
              radius: 12,
            ),
          ],
        ),
      ),
    );
    await tester.pump();

    expect(elsewhere.hasFocus, isTrue);
  });

  testWidgets('a disabled composer is not asked to focus itself',
      (tester) async {
    await tester.pumpWidget(_wrap(Composer(onSend: (_) {}, enabled: false)));

    await tester.pumpWidget(
      _wrap(
        Composer(
          onSend: (_) {},
          enabled: false,
          replyTo: _target(),
          onCancelReply: () {},
        ),
      ),
    );
    await tester.pump();

    expect(
      tester
          .widget<TextField>(find.byKey(const Key('composer.message')))
          .focusNode!
          .hasFocus,
      isFalse,
    );
    // The chip and its way out are still drawn: a gate that holds the box
    // shut must not also trap the customer in a reply.
    expect(_chip, findsOneWidget);
    expect(tester.widget<IconButton>(_cancel).onPressed, isNotNull);
  });
}
