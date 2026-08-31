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
}
