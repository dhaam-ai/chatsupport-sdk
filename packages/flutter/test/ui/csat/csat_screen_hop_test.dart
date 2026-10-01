// The screen hop: that `ConversationScreen` actually RENDERS the three
// end-of-conversation surfaces the Cubit decides are due.
//
// `csat_surface_test.dart` proves the Cubit raises them; the three widget
// files prove each one behaves once on screen. Neither proves the dispatch
// between the two, and a missing `case` arm is silent — the surface falls
// through to the conversation and the customer simply never sees the card.
// This file is that seam.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';
import 'fake_session_actions.dart';

/// Drains the fake client's queued microtasks and the CSAT lookup's own
/// round trip, then builds a frame. See `conversation_screen_test.dart`'s
/// own `flush` for why this steps out of the fake clock.
Future<void> flush(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  await tester.pump();
}

Widget _wrap(ChatWidgetCubit cubit) => BlocProvider<ChatWidgetCubit>.value(
      value: cubit,
      child: const MaterialApp(home: Scaffold(body: ConversationScreen())),
    );

void main() {
  late FakeWidgetChatClient client;
  late FakeSessionActions actions;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    actions = FakeSessionActions();
    cubit = ChatWidgetCubit(client: client, sessionActions: actions);
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  /// A session with one message in it, resolved the ordinary way.
  Future<void> endedWithATranscript(WidgetTester tester) async {
    client.emitSession(testSession(status: ChatStatus.assigned));
    client.emitMessage(testMessage(id: 'm1'));
    await flush(tester);
    client.emitSession(testSession(status: ChatStatus.resolved));
    for (int i = 0; i < 4; i += 1) {
      await flush(tester);
    }
  }

  testWidgets(
      'an unrated ended session renders the survey in place of the '
      'conversation', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await endedWithATranscript(tester);

    expect(find.text('How was your support experience?'), findsOneWidget);
    expect(find.byKey(csatOptionKey(5)), findsOneWidget);
    // In place of, never alongside.
    expect(find.byType(Composer), findsNothing);
  });

  testWidgets(
      'a rated session renders the LOCKED card, filled from the '
      'machine mirror', (tester) async {
    actions.csatOnFile = const CsatRated(rating: 4, comment: 'Sorted fast');
    await tester.pumpWidget(_wrap(cubit));
    await endedWithATranscript(tester);

    expect(find.text('Your rating'), findsWidgets);
    // The comment comes back as text, and there is no submit control at all.
    expect(find.text('Sorted fast'), findsOneWidget);
    expect(find.text('Submit feedback'), findsNothing);
  });

  // Without a differing key Flutter reuses the State and the locked read-out
  // never draws over the ask it replaces.
  testWidgets('the card swaps from ask to locked when a rating is recorded',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await endedWithATranscript(tester);
    expect(find.text('How was your support experience?'), findsOneWidget);

    await tester.tap(find.byKey(csatOptionKey(3)));
    await tester.pump();
    await tester.tap(find.text('Submit feedback'));
    for (int i = 0; i < 4; i += 1) {
      await flush(tester);
    }

    expect(find.text('Your rating'), findsWidgets);
    expect(find.text('How was your support experience?'), findsNothing);
    expect(actions.submitted, hasLength(1));
  });

  testWidgets(
      'a terminal session with no card due renders the ended footer '
      'WHERE THE COMPOSER WAS', (tester) async {
    // An empty transcript has nothing to rate, so no card is due and the
    // footer is what is left.
    await tester.pumpWidget(_wrap(cubit));
    client.emitSession(testSession(status: ChatStatus.resolved));
    for (int i = 0; i < 3; i += 1) {
      await flush(tester);
    }

    expect(find.byType(EndedFooter), findsOneWidget);
    expect(find.text('Reopen conversation'), findsOneWidget);
    expect(find.text('New conversation'), findsOneWidget);
    // A sibling of the composer, not a surface: the transcript is still
    // there, because it is the thing being decided about.
    expect(find.byType(MessageListView), findsOneWidget);
    expect(find.byType(Composer), findsNothing);
  });

  testWidgets('a live session keeps the composer and no footer',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    client.emitSession(testSession(status: ChatStatus.assigned));
    await flush(tester);

    // Asserted first: every "renders nothing" expectation below is also
    // satisfied by a session that never landed, so the session has to be
    // proven before they mean anything.
    expect(cubit.state.session, isNotNull);
    expect(find.byType(Composer), findsOneWidget);
    expect(find.byType(EndedFooter), findsNothing);
  });

  testWidgets('a SWITCHED close renders neither — that session was parked',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    client.emitSession(testSession(status: ChatStatus.assigned));
    client.emitMessage(testMessage(id: 'm1'));
    await flush(tester);
    client.emitSessionClosed('s1', CloseReason.switched);
    client.emitSession(testSession(status: ChatStatus.closed));
    for (int i = 0; i < 4; i += 1) {
      await flush(tester);
    }

    // Same guard: a parked session still has to BE a session, or this proves
    // only that nothing loaded.
    expect(cubit.state.session?.status, ChatStatus.closed);
    expect(find.byKey(csatOptionKey(1)), findsNothing);
    expect(find.byType(EndedFooter), findsNothing);
    expect(find.byType(Composer), findsOneWidget);
  });

  testWidgets('the end-conversation question renders in the slot',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    client.emitSession(testSession(status: ChatStatus.assigned));
    for (int i = 0; i < 3; i += 1) {
      await flush(tester);
    }
    // `openEndConversation` is a no-op without a session to close, so a
    // snapshot that has not landed yet would make this test pass vacuously
    // by asserting the surface never appeared.
    expect(cubit.state.session, isNotNull);

    cubit.openEndConversation();
    await flush(tester);

    expect(find.text('End this conversation?'), findsWidgets);
    expect(find.widgetWithText(TextButton, 'Keep chatting'), findsOneWidget);
    expect(find.byType(Composer), findsNothing);

    // And Cancel gives the conversation back.
    await tester.tap(find.widgetWithText(TextButton, 'Keep chatting'));
    await flush(tester);
    expect(find.byType(Composer), findsOneWidget);
  });

  // Nothing on the Flutter side drove the agent's typing indicator before the
  // screen passed `onTyping` through.
  testWidgets('the composer drives the outbound typing signal', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    client.emitSession(testSession(status: ChatStatus.assigned));
    await flush(tester);

    await tester.enterText(find.byType(TextField), 'hel');
    await tester.pump();

    expect(client.startTypingCalls, greaterThan(0));
  });
}
