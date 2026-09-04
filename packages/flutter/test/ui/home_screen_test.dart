import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';
import '../support/remote_config_fixtures.dart';

Widget _wrap(ChatWidgetCubit cubit) {
  return BlocProvider<ChatWidgetCubit>.value(
    value: cubit,
    child: const MaterialApp(home: Scaffold(body: HomeScreen())),
  );
}

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  testWidgets('renders the CTA card', (tester) async {
    cubit = ChatWidgetCubit(client: client);
    await tester.pumpWidget(_wrap(cubit));
    expect(find.text('Send us a message'), findsOneWidget);
  });

  testWidgets('the CTA subtitle is the header\'s ctaSubtitle, hidden when unset', (tester) async {
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(header: const HeaderAppearance(ctaSubtitle: 'We reply within an hour')),
    );
    await tester.pumpWidget(_wrap(cubit));
    expect(find.text('We reply within an hour'), findsOneWidget);
  });

  testWidgets('tapping the CTA starts a new conversation', (tester) async {
    cubit = ChatWidgetCubit(client: client);
    await tester.pumpWidget(_wrap(cubit));

    await tester.tap(find.text('Send us a message'));
    await tester.pump();

    expect(cubit.state.screen, ScreenName.conversation);
    expect(cubit.state.composingNew, isTrue);
    // The getter and the slot are one fact — see ChatWidgetState.composingNew.
    expect(cubit.state.activeSurface, isA<ComposingNewSurface>());
    // A form opened from Home is a DETOUR, not a conversation: counting it
    // would arm the pre-chat gate behind the very form already asking those
    // questions.
    expect(cubit.state.conversationOpened, isFalse);
  });

  testWidgets('no Recent conversation section when there are no summaries', (tester) async {
    cubit = ChatWidgetCubit(client: client);
    await tester.pumpWidget(_wrap(cubit));
    // _SectionHeading renders its text upper-cased.
    expect(find.text('RECENT CONVERSATION'), findsNothing);
  });

  testWidgets('shows the most recent conversation, and opens it on tap', (tester) async {
    cubit = ChatWidgetCubit(client: client);
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      ChatSessionSummary(
        id: 'older',
        status: ChatStatus.open,
        mode: ChatMode.human,
        createdAt: DateTime.utc(2026, 1, 1),
        lastMessageAt: DateTime.utc(2026, 1, 1),
      ),
      ChatSessionSummary(
        id: 'newest',
        status: ChatStatus.resolved,
        mode: ChatMode.human,
        createdAt: DateTime.utc(2026, 1, 1),
        lastMessageAt: DateTime.utc(2026, 6, 1),
        lastMessagePreview: 'Thanks for your help!',
        handledBy: const HandledBy(kind: HandledByKind.agent, id: 'a1', displayName: 'Priya'),
      ),
    ]);
    await tester.pumpWidget(_wrap(cubit));

    expect(find.text('RECENT CONVERSATION'), findsOneWidget);
    expect(find.text('Priya'), findsOneWidget);
    expect(find.text('Resolved'), findsOneWidget);
    expect(find.text('Thanks for your help!'), findsOneWidget);

    await tester.tap(find.text('Priya'));
    expect(client.joinedSessionIds, <String>['newest']);
    expect(cubit.state.screen, ScreenName.conversation);
    expect(cubit.state.composingNew, isFalse);
  });

  testWidgets('a recent conversation nobody has picked up still says where it stands', (tester) async {
    cubit = ChatWidgetCubit(client: client);
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      ChatSessionSummary(id: 'x', status: ChatStatus.open, mode: ChatMode.bot, createdAt: DateTime.utc(2026, 1, 1)),
    ]);
    await tester.pumpWidget(_wrap(cubit));

    // No handledBy -> falls back to "Conversation" rather than inventing a
    // title. The status pill is NOT part of that fallback: OPEN used to have
    // no entry in the pill map and rendered nothing, which left the row unable
    // to say anything about itself at all.
    expect(find.text('Conversation'), findsOneWidget);
    expect(find.text('Open'), findsOneWidget);
  });

  testWidgets('See all switches to the Messages tab', (tester) async {
    cubit = ChatWidgetCubit(client: client);
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      ChatSessionSummary(id: 'x', status: ChatStatus.open, mode: ChatMode.bot, createdAt: DateTime.utc(2026, 1, 1)),
    ]);
    await tester.pumpWidget(_wrap(cubit));

    await tester.tap(find.text('See all'));
    expect(cubit.state.screen, ScreenName.messages);
  });

  testWidgets('no Common Questions section when the console configured none', (tester) async {
    cubit = ChatWidgetCubit(client: client);
    await tester.pumpWidget(_wrap(cubit));
    expect(find.text('COMMON QUESTIONS'), findsNothing);
  });

  testWidgets('tapping a common question starts a new conversation and sends its PROMPT, not its label', (tester) async {
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(
        commonQuestions: const <CommonQuestion>[
          CommonQuestion(id: 'q1', label: 'Shipping?', prompt: 'How long does shipping take?'),
        ],
      ),
    );
    await tester.pumpWidget(_wrap(cubit));

    expect(find.text('Shipping?'), findsOneWidget);
    await tester.tap(find.text('Shipping?'));
    await tester.pump();

    expect(cubit.state.screen, ScreenName.conversation);
    expect(client.sentContent, <String>['How long does shipping take?']);
    // The new-conversation surface is never raised at all on this route: a
    // tapped question is a customer asking one specific thing, not filling
    // in a form — see ChatWidgetCubit.startCommonQuestion.
    expect(cubit.state.composingNew, isFalse);
    expect(cubit.state.activeSurface, isNull);
    expect(cubit.state.conversationOpened, isTrue);
  });
}
