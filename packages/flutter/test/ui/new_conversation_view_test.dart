import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';
import '../support/remote_config_fixtures.dart';

Widget _wrap(ChatWidgetCubit cubit) {
  return BlocProvider<ChatWidgetCubit>.value(
    value: cubit,
    child: const MaterialApp(home: Scaffold(body: NewConversationView())),
  );
}

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  testWidgets('no topic section when the console configured none', (tester) async {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(client: client);
    cubit.startNewConversation();
    await tester.pumpWidget(_wrap(cubit));
    expect(find.byType(ChoiceChip), findsNothing);
  });

  testWidgets('renders topic chips and selecting one calls the Cubit', (tester) async {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(
        conversationTopics: const <ConversationTopic>[ConversationTopic(id: 't1', label: 'Delivery issue')],
      ),
    );
    cubit.startNewConversation();
    await tester.pumpWidget(_wrap(cubit));

    expect(find.text('Delivery issue'), findsOneWidget);
    await tester.tap(find.text('Delivery issue'));
    await tester.pump();

    expect(cubit.state.selectedTopic, const ConversationTopic(id: 't1', label: 'Delivery issue'));
    // The chip's own visual state follows the Cubit, not local widget state.
    final ChoiceChip chip = tester.widget(find.byType(ChoiceChip));
    expect(chip.selected, isTrue);
  });

  testWidgets('Start is disabled until the textarea has non-blank content', (tester) async {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(client: client);
    cubit.startNewConversation();
    await tester.pumpWidget(_wrap(cubit));

    FilledButton start() => tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Start'));
    expect(start().onPressed, isNull);

    await tester.enterText(find.byType(TextField), '   ');
    await tester.pump();
    expect(start().onPressed, isNull, reason: 'whitespace-only is not real content');

    await tester.enterText(find.byType(TextField), 'My order never arrived');
    await tester.pump();
    expect(start().onPressed, isNotNull);
  });

  testWidgets('tapping Start sends the trimmed message', (tester) async {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(client: client);
    cubit.startNewConversation();
    await tester.pumpWidget(_wrap(cubit));

    await tester.enterText(find.byType(TextField), '  My order never arrived  ');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Start'));
    await tester.pump();

    expect(client.sentContent, <String>['My order never arrived']);
    expect(cubit.state.composingNew, isFalse);
  });

  // ── T8: the new-conversation form's own acceptance criteria ────────────
  //
  // Reproduces `new-conversation.test.ts`'s topic, answers and validation
  // blocks. The gate-vs-form precedence is in
  // `test/ui/pre_chat/pre_chat_gating_test.dart`.

  group('topic chips send the LABEL, not the id', () {
    const List<ConversationTopic> topics = <ConversationTopic>[
      ConversationTopic(id: 'delivery', label: 'Delivery issue'),
      ConversationTopic(id: 'refund', label: 'Refund request'),
    ];

    ChatWidgetCubit build() {
      client = FakeWidgetChatClient();
      return ChatWidgetCubit(
        client: client,
        initialConfig: testRemoteConfig(conversationTopics: topics),
      );
    }

    testWidgets('a picked chip travels as its label', (tester) async {
      cubit = build();
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      await tester.tap(find.text('Delivery issue'));
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'It never arrived');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Start'));
      await tester.pump();

      // The id is a console key; the label is what the customer saw
      // themselves press, and what an agent reads.
      expect(cubit.state.startedTopicLabel, 'Delivery issue');
      expect(client.sentContent, <String>['It never arrived']);
      // The LIVE selection is cleared by the start — its job was to
      // accompany THIS compose, not to pre-select a chip for the next one.
      expect(cubit.state.selectedTopic, isNull);
    });

    // "No topic" has to stay reachable — a chip is an optional refinement,
    // never a requirement to start.
    testWidgets('a second tap on the same chip clears the selection',
        (tester) async {
      cubit = build();
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      await tester.tap(find.text('Delivery issue'));
      await tester.pump();
      expect(cubit.state.selectedTopic, isNotNull);

      await tester.tap(find.text('Delivery issue'));
      await tester.pump();
      expect(cubit.state.selectedTopic, isNull);
    });

    testWidgets('only one chip is selected at a time', (tester) async {
      cubit = build();
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      await tester.tap(find.text('Delivery issue'));
      await tester.pump();
      await tester.tap(find.text('Refund request'));
      await tester.pump();

      expect(cubit.state.selectedTopic?.id, 'refund');
    });
  });

  group('pre-chat fields folded in', () {
    const PreChatField name = PreChatField(
      id: 'name',
      label: 'Your name',
      type: PreChatFieldType.text,
      required: true,
    );
    const PreChatField order = PreChatField(
      id: 'order',
      label: 'Order number',
      type: PreChatFieldType.text,
      required: false,
    );

    ChatWidgetCubit build({
      List<PreChatField> fields = const <PreChatField>[],
      ChatIdentity identity = ChatIdentity.guest,
    }) {
      client = FakeWidgetChatClient();
      return ChatWidgetCubit(
        client: client,
        identity: identity,
        initialConfig: testRemoteConfig(
          preChatEnabled: true,
          preChatFields: fields,
        ),
      );
    }

    testWidgets('collects them from a GUEST, above the message box',
        (tester) async {
      cubit = build(fields: const <PreChatField>[name, order]);
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      expect(find.text(kPreChatSubtitle), findsOneWidget);
      expect(find.text('Your name'), findsOneWidget);
      // Optional is marked; required is not.
      expect(find.text('Order number (optional)'), findsOneWidget);
    });

    // The form itself survives; only the questions go.
    testWidgets('omits them for a LOGGED-IN visitor, form intact',
        (tester) async {
      cubit = build(
        fields: const <PreChatField>[name, order],
        identity: const ChatIdentity(
          userId: 'cus_1',
          profile: ChatParticipantProfile(name: 'Jordan'),
        ),
      );
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      expect(find.text(kPreChatSubtitle), findsNothing);
      expect(find.text('Your name'), findsNothing);
      expect(find.widgetWithText(FilledButton, 'Start'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
    });

    // Top to bottom, the order the customer reads: naming the message as
    // missing while a required field above it is empty sends them to the
    // wrong box.
    testWidgets('checks the details BEFORE the message', (tester) async {
      cubit = build(fields: const <PreChatField>[name]);
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      await tester.enterText(
        find.widgetWithText(TextField, 'Type your message…'),
        'It never arrived',
      );
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Start'));
      await tester.pump();

      expect(find.text('Your name is required.'), findsOneWidget);
      expect(client.sentContent, isEmpty);
    });

    testWidgets('sends the details ahead of the opening line', (tester) async {
      cubit = build(fields: const <PreChatField>[name, order]);
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      await tester.enterText(
        find.widgetWithText(TextField, 'Your name'),
        '  Ada  ',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Type your message…'),
        'It never arrived',
      );
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Start'));
      await tester.pump();

      expect(client.sentContent, <String>[
        'Your name: Ada',
        'It never arrived',
      ]);
      // Trimmed, and the blank optional omitted rather than sent as ''.
      expect(cubit.state.preChatAnswers, <String, String>{'name': 'Ada'});
      expect(cubit.state.preChatAnswered, isTrue);
    });

    // ── absent and empty are different states, and both are asserted ─────

    testWidgets('preChatAnswers is ABSENT when no fields showed',
        (tester) async {
      cubit = build();
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      await tester.enterText(find.byType(TextField), 'Hello');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Start'));
      await tester.pump();

      expect(client.sentContent, <String>['Hello']);
      expect(cubit.state.preChatAnswers, isNull);
      // Never asked, so a later form still asks.
      expect(cubit.state.preChatAnswered, isFalse);
    });

    testWidgets(
        'preChatAnswers is an EMPTY RECORD when they showed and every '
        'optional was left blank', (tester) async {
      cubit = build(fields: const <PreChatField>[order]);
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      await tester.enterText(
        find.widgetWithText(TextField, 'Type your message…'),
        'Hello',
      );
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Start'));
      await tester.pump();

      // Only the opening line: there was nothing to relay.
      expect(client.sentContent, <String>['Hello']);
      expect(cubit.state.preChatAnswers, isNotNull);
      expect(cubit.state.preChatAnswers, isEmpty);
      // Asked and declined DOES count — unlike the absent case above.
      expect(cubit.state.preChatAnswered, isTrue);
    });
  });

  group('Cancel', () {
    testWidgets('backs out to the screen the form was opened from',
        (tester) async {
      client = FakeWidgetChatClient();
      cubit = ChatWidgetCubit(client: client);
      cubit.startNewConversation();
      await tester.pumpWidget(_wrap(cubit));

      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pump();

      expect(cubit.state.screen, ScreenName.home);
      expect(cubit.state.activeSurface, isNull);
    });
  });
}
