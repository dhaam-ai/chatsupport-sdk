// Reply, end to end: the menu item is OFFERED, it addresses a real message,
// and both halves reach the wire.
//
// T9 built the menu with Copy and Reply and left
// `MessageListCallbacks.onReplyToMessage` as a seam whose item is ABSENT when
// null — so until this wiring landed the Reply item did not render at all.
// The first test here is the one that would have caught that: it asserts the
// affordance exists, not merely that a callback fires when invoked directly.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';

/// See conversation_screen_test.dart's own copy for why this is
/// `runAsync` + `pump` and not `Future.delayed`.
Future<void> flush(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  await tester.pump();
}

Widget _wrap(ChatWidgetCubit cubit, {ThemeData? theme}) {
  return BlocProvider<ChatWidgetCubit>.value(
    value: cubit,
    child: MaterialApp(
      theme: theme,
      home: const Scaffold(body: ConversationScreen()),
    ),
  );
}

ChatMessage _agentMessage({
  String id = 'm-agent',
  String content = 'Have you tried the receipt link?',
}) =>
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

final Finder _chip = find.byKey(const Key('composer.replyChip'));
final Finder _box = find.byKey(const Key('composer.message'));
final Finder _send = find.widgetWithIcon(IconButton, Icons.send);

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(client: client);
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  /// Puts one agent message in the transcript and opens its ⋯ menu.
  Future<void> openMenu(WidgetTester tester) async {
    client.emitMessage(_agentMessage());
    await flush(tester);
    await tester.tap(find.byTooltip('Message actions'));
    await tester.pumpAndSettle();
  }

  /// Presses Reply on that message.
  Future<void> startReply(WidgetTester tester) async {
    await openMenu(tester);
    await tester.tap(find.text('Reply'));
    await tester.pumpAndSettle();
  }

  Future<void> sendText(WidgetTester tester, String text) async {
    await tester.enterText(_box, text);
    await tester.pump();
    await tester.tap(_send);
    await tester.pump();
  }

  testWidgets('the Reply item is OFFERED on a message', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await openMenu(tester);

    // The seam is filled, so the item renders. With `onReplyToMessage` null
    // this finds nothing — which was the state of the widget before this
    // node, and the reason the item is absent rather than disabled.
    expect(find.text('Reply'), findsOneWidget);
    // Copy was never broken; asserted alongside so a regression that removed
    // the whole menu could not pass this file.
    expect(find.text('Copy'), findsOneWidget);
  });

  testWidgets('pressing Reply raises the chip naming the message',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await startReply(tester);

    expect(_chip, findsOneWidget);
    expect(cubit.state.replyingTo!.messageId, 'm-agent');
    expect(
      cubit.state.replyingTo!.excerpt,
      'Have you tried the receipt link?',
    );
    // Resolved by the transcript and handed over — a ChatMessage carries no
    // display name for this to have come from.
    expect(cubit.state.replyingTo!.senderName, isNotEmpty);
    expect(find.text('Have you tried the receipt link?'), findsWidgets);
  });

  testWidgets('the send carries BOTH halves of the reply', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await startReply(tester);
    await sendText(tester, 'Yes, it 404s');

    expect(client.sentContent, <String>['Yes, it 404s']);
    // The protocol-native half.
    expect(client.sentReplyToMessageId, <String?>['m-agent']);

    // The renderable half. Without it the reader draws no quote at all, and
    // the whole feature is invisible to the person being replied to.
    final ReplyQuote? quote = readReplyQuote(client.sentMetadata.single);
    expect(quote, isNotNull);
    expect(quote!.excerpt, 'Have you tried the receipt link?');
  });

  testWidgets('the id and the quote always name the SAME message',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await startReply(tester);
    await sendText(tester, 'Yes');

    final Object? replyTo = (client.sentMetadata.single!['replyTo']!
        as Map<String, Object?>)['messageId'];
    // Both are read off the one ReplyTarget, so a mismatched pair is not
    // reachable.
    expect(replyTo, client.sentReplyToMessageId.single);
  });

  testWidgets('sending clears the target, and the NEXT message is not a reply',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await startReply(tester);
    await sendText(tester, 'Yes, it 404s');
    await tester.pump();

    expect(cubit.state.replyingTo, isNull);
    expect(_chip, findsNothing);

    await sendText(tester, 'And so does the other one');

    expect(client.sentReplyToMessageId, <String?>['m-agent', null]);
    expect(client.sentMetadata.last, isNull);
  });

  testWidgets('dismissing the chip means the next send carries no reply',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await startReply(tester);

    await tester.tap(find.byTooltip('Cancel reply'));
    await tester.pump();

    expect(cubit.state.replyingTo, isNull);
    expect(_chip, findsNothing);

    await sendText(tester, 'Never mind');

    // A customer who tapped Reply by mistake backed out, and the message they
    // actually meant to send went as an ordinary one.
    expect(client.sentReplyToMessageId, <String?>[null]);
    expect(client.sentMetadata, <Map<String, Object?>?>[null]);
  });

  testWidgets('the chip survives a rebuild that has nothing to do with it',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await startReply(tester);
    expect(_chip, findsOneWidget);

    // A theme change rebuilds the whole subtree. Held in ConversationScreen's
    // own State this would be kept by luck; held anywhere a State can be
    // recreated it would be lost outright.
    await tester.pumpWidget(_wrap(cubit, theme: ThemeData.dark()));
    await tester.pump();

    expect(_chip, findsOneWidget);
    expect(cubit.state.replyingTo!.messageId, 'm-agent');

    // And the target still travels after the rebuild.
    await sendText(tester, 'Still replying');
    expect(client.sentReplyToMessageId, <String?>['m-agent']);
  });

  testWidgets('an unrelated message arriving does not disturb the chip',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await startReply(tester);

    client.emitMessage(_agentMessage(id: 'm-noise', content: 'Still there?'));
    await flush(tester);

    expect(_chip, findsOneWidget);
    expect(cubit.state.replyingTo!.messageId, 'm-agent');
  });

  testWidgets('a quick reply is a reply too when one is being composed',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await startReply(tester);

    // A suggestion chip goes through the composer's own submit, which is the
    // same `onSend` a typed message takes — so it picks up the reply target
    // and clears it, exactly as typing would. That is the point of routing it
    // through the composer rather than straight to the client.
    cubit.sendMessage('Sent from a chip');
    await tester.pump();

    expect(client.sentReplyToMessageId, <String?>['m-agent']);
    expect(cubit.state.replyingTo, isNull);
  });
}
