// Reproduces `pre-chat-preemption.test.ts:347` — the reported "New
// conversation does nothing".
//
// A store tick used to re-arm the pre-chat gate over the form the customer
// was typing into: the freshly minted, still-empty session made "questions
// configured, no answer yet, no messages" momentarily true, and the gate took
// the slot back with their text in it. This drives the REAL screen, not the
// slot in isolation, because the half that was actually broken is whether the
// widget survives the rebuild.

import 'package:dhaam_chat/dhaam_chat.dart' show ChatStatus;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';
import '../../support/remote_config_fixtures.dart';

const List<PreChatField> _fields = <PreChatField>[
  PreChatField(
    id: 'name',
    label: 'Your name',
    type: PreChatFieldType.text,
    required: true,
  ),
];

Widget _wrap(ChatWidgetCubit cubit) => BlocProvider<ChatWidgetCubit>.value(
      value: cubit,
      child: const MaterialApp(home: Scaffold(body: ConversationScreen())),
    );

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  // Built inside each test body, never in `setUp`. A StreamController created
  // outside `testWidgets`' fake-async zone schedules its delivery microtasks
  // in the enclosing zone, where `tester.pump()` never drains them — the
  // events simply never arrive. Same convention the other widget tests in
  // this package already follow.
  void mount({required String? sessionId, RemoteConfig? config}) {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: config ??
          testRemoteConfig(preChatEnabled: true, preChatFields: _fields),
      sessionId: sessionId,
    );
  }

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  testWidgets('the new-conversation form replaces an armed gate on screen',
      (WidgetTester tester) async {
    mount(sessionId: 'sess_1');
    client.emitSession(testSession(id: 'sess_1'));
    await tester.pumpWidget(_wrap(cubit));
    await tester.pump();
    await tester.pump();

    expect(find.byType(PreChatGate), findsOneWidget);

    cubit.startNewConversation();
    await tester.pump();
    await tester.pump();

    expect(find.byType(PreChatGate), findsNothing);
    expect(find.byType(NewConversationView), findsOneWidget);
  });

  testWidgets(
      'keeps the form — and what was typed into it — through a store '
      'change that used to re-arm the gate', (WidgetTester tester) async {
    mount(sessionId: 'sess_1');
    client.emitSession(testSession(id: 'sess_1'));
    await tester.pumpWidget(_wrap(cubit));
    await tester.pump();
    await tester.pump();

    cubit.startNewConversation();
    await tester.pump();
    await tester.pump();

    await tester.enterText(
      find.widgetWithText(TextField, 'Your name'),
      'Ada',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Type your message…'),
      'Half typed',
    );
    await tester.pump();

    // A real `session.updated` push — the tick that used to do the damage.
    client.emitSession(testSession(id: 'sess_1', status: ChatStatus.open));
    await tester.pump();
    await tester.pump();

    expect(find.byType(PreChatGate), findsNothing);
    expect(find.byType(NewConversationView), findsOneWidget);
    // Not merely "a form is on screen": the SAME form, still holding their
    // text. A rebuilt one would pass the check above and still have lost it.
    expect(find.text('Ada'), findsOneWidget);
    expect(find.text('Half typed'), findsOneWidget);
  });

  testWidgets(
      'an arriving message closes the gate — a transcript with '
      'something in it is a conversation already under way',
      (WidgetTester tester) async {
    mount(sessionId: 'sess_1');
    client.emitSession(testSession(id: 'sess_1'));
    await tester.pumpWidget(_wrap(cubit));
    await tester.pump();
    await tester.pump();
    expect(find.byType(PreChatGate), findsOneWidget);

    client.emitMessage(testMessage(id: 'm1', content: 'Hello there'));
    await tester.pump();
    await tester.pump();

    expect(find.byType(PreChatGate), findsNothing);
  });
}
