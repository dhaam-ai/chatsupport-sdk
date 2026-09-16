/// A conversation the merchant has CLOSED is not on the customer's
/// conversation surfaces — the Flutter port of the widget's
/// `closed-session-hidden.test.ts`.
///
/// ── The boundary is the rendered tree, not the filter ───────────────────
///
/// Every case here mounts a real screen over a real [ChatWidgetCubit] and
/// asks what a customer can SEE, rather than calling the rule directly: the
/// rule has one home ([ChatWidgetState.customerVisibleSessions]) and three
/// readers, and a test of the function alone would stay green if any one of
/// the three stopped reading it.
///
/// ── CLOSED only, and RESOLVED is the reason to say so ───────────────────
///
/// `resolved` and `closed` are two different states and exactly one of them
/// is withheld. The RESOLVED cases below are not padding: they are what
/// stops a later change from quietly filtering "the terminal ones" and
/// taking the customer's reopen path with it.
library;

import 'package:dhaam_chat/dhaam_chat.dart' hide ConnectionState;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';
import '../support/remote_config_fixtures.dart';

ChatSessionSummary _summary({
  required String id,
  required ChatStatus status,
  String? subject,
  String? preview,
  DateTime? lastMessageAt,
  int unreadCount = 0,
}) =>
    ChatSessionSummary(
      id: id,
      status: status,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 1, 1),
      lastMessageAt: lastMessageAt ?? DateTime.utc(2026, 1, 2),
      lastMessagePreview: preview,
      subject: subject,
      unreadCount: unreadCount,
    );

/// Delivers a queued stream event AND renders the state it produces.
///
/// The same two steps `ui/conversation_screen_test.dart`'s own `flush` takes,
/// and for the reason stated there: `FakeWidgetChatClient`'s controllers are
/// built in `setUp`, outside the fake clock a `testWidgets` body runs on, so
/// a snapshot handed to `emitSession` is a microtask nothing inside that zone
/// will ever run. [WidgetTester.runAsync] steps out onto the real clock long
/// enough for it to be delivered; the `pump` after it is what turns the
/// resulting Cubit state into a frame.
Future<void> flush(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  await tester.pump();
}

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(client: client, initialConfig: testRemoteConfig());
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  Widget wrapMessages() => BlocProvider<ChatWidgetCubit>.value(
        value: cubit,
        child: const MaterialApp(home: Scaffold(body: MessagesScreen())),
      );

  group('the Messages screen', () {
    testWidgets('does not list a conversation the merchant has closed',
        (WidgetTester tester) async {
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(
            id: 'closed_one',
            status: ChatStatus.closed,
            subject: 'Closed conversation'),
      ]);
      await tester.pumpWidget(wrapMessages());

      expect(find.text('Closed conversation'), findsNothing);
      // And the screen accounts for the empty list in its own words —
      // WITHOUT claiming the customer has none. They have one. A customer
      // with zero conversations and a customer whose only conversation the
      // merchant closed are different situations, and copy that reads
      // identically for both is the screen making a statement that is
      // simply false for one of them.
      expect(find.text('Your previous conversations have been closed.'),
          findsOneWidget);
      expect(find.text('No previous conversations yet.'), findsNothing);
    });

    testWidgets('and says something DIFFERENT when there genuinely are none',
        (WidgetTester tester) async {
      // The other half of the pair, and what makes the sentence above
      // load-bearing rather than a reworded constant: this screen has to be
      // able to TELL the two apart, so one copy change that swallowed both
      // cases would fail here.
      await tester.pumpWidget(wrapMessages());

      expect(find.text('No previous conversations yet.'), findsOneWidget);
      expect(find.text('Your previous conversations have been closed.'),
          findsNothing);
    });

    testWidgets('a typed query still answers the SEARCH, not the closure',
        (WidgetTester tester) async {
      // Precedence, decided rather than fallen into: the customer asked a
      // question by typing, and the screen answers that one. Neither
      // sentence is false here — nothing matches AND everything they have
      // is closed — so the reply is to the thing they just did, and
      // clearing the box then tells them the rest.
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 'closed_one', status: ChatStatus.closed),
      ]);
      await tester.pumpWidget(wrapMessages());

      await tester.enterText(find.byType(TextField), 'nothing matches this');
      await tester.pumpAndSettle();

      expect(find.text('No conversations match your search.'), findsOneWidget);
      expect(find.text('Your previous conversations have been closed.'),
          findsNothing);
    });

    testWidgets('keeps a RESOLVED one — the reopen path is not withheld',
        (WidgetTester tester) async {
      // The user's own correction, pinned: "resolved and closed are 2
      // different states". A change that filtered both would pass every
      // case above this one.
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(
            id: 'resolved_one',
            status: ChatStatus.resolved,
            subject: 'Resolved conversation'),
      ]);
      await tester.pumpWidget(wrapMessages());

      expect(find.text('Resolved conversation'), findsOneWidget);
      // Still carrying its own status word, not quietly relabelled.
      expect(find.text('Resolved'), findsOneWidget);
    });

    testWidgets('drops only the closed one out of a mixed list',
        (WidgetTester tester) async {
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 'a', status: ChatStatus.open, subject: 'Open one'),
        _summary(id: 'b', status: ChatStatus.resolved, subject: 'Resolved one'),
        _summary(
            id: 'c', status: ChatStatus.waitingForAgent, subject: 'Waiting one'),
        _summary(id: 'd', status: ChatStatus.onHold, subject: 'On-hold one'),
        _summary(id: 'e', status: ChatStatus.assigned, subject: 'Assigned one'),
        _summary(id: 'f', status: ChatStatus.closed, subject: 'Closed one'),
      ]);
      await tester.pumpWidget(wrapMessages());

      // Five of six, and not "the terminal ones".
      expect(find.text('Open one'), findsOneWidget);
      expect(find.text('Resolved one'), findsOneWidget);
      expect(find.text('Waiting one'), findsOneWidget);
      expect(find.text('On-hold one'), findsOneWidget);
      expect(find.text('Assigned one'), findsOneWidget);
      expect(find.text('Closed one'), findsNothing);
    });
  });

  group('the Home screen', () {
    Widget wrapHome() => BlocProvider<ChatWidgetCubit>.value(
          value: cubit,
          child: const MaterialApp(home: Scaffold(body: HomeScreen())),
        );

    testWidgets(
        'surfaces the most recent NON-CLOSED conversation, not nothing at all',
        (WidgetTester tester) async {
      // The decision the user was asked directly and made: when the newest
      // conversation has been closed, Home falls through to the newest one
      // the customer still has, rather than dropping the whole Recent
      // section because the row it would have shown is gone.
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(
          id: 'older_open',
          status: ChatStatus.open,
          preview: 'Still going',
          lastMessageAt: DateTime.utc(2026, 1, 2),
        ),
        _summary(
          id: 'newest_closed',
          status: ChatStatus.closed,
          preview: 'Taken off the table',
          lastMessageAt: DateTime.utc(2026, 6, 1),
        ),
      ]);
      await tester.pumpWidget(wrapHome());

      expect(find.text('RECENT CONVERSATION'), findsOneWidget);
      expect(find.text('Still going'), findsOneWidget);
      expect(find.text('Taken off the table'), findsNothing);
      // The pill is the row's own status word, so this is also the
      // conversation the customer is offered, not just the text beside it.
      expect(find.text('Open'), findsOneWidget);
      expect(find.text('Closed'), findsNothing);
    });

    testWidgets('has no Recent section when the only conversation is closed',
        (WidgetTester tester) async {
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(
            id: 'closed_one',
            status: ChatStatus.closed,
            preview: 'Taken off the table'),
      ]);
      await tester.pumpWidget(wrapHome());

      expect(find.text('RECENT CONVERSATION'), findsNothing);
      expect(find.text('Taken off the table'), findsNothing);
    });

    testWidgets('a RESOLVED conversation still leads Home',
        (WidgetTester tester) async {
      // Unlike the web widget, this screen has no status table gating the
      // section (see home_screen.dart): every status it is handed renders,
      // and CLOSED is withheld upstream rather than gated here. So a
      // resolved newest is the Recent row, pill and all.
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(
          id: 'older_open',
          status: ChatStatus.open,
          preview: 'Still going',
          lastMessageAt: DateTime.utc(2026, 1, 2),
        ),
        _summary(
          id: 'newest_resolved',
          status: ChatStatus.resolved,
          preview: 'All sorted, thanks',
          lastMessageAt: DateTime.utc(2026, 6, 1),
        ),
      ]);
      await tester.pumpWidget(wrapHome());

      expect(find.text('RECENT CONVERSATION'), findsOneWidget);
      expect(find.text('All sorted, thanks'), findsOneWidget);
      expect(find.text('Resolved'), findsOneWidget);
    });
  });

  group('the in-chat session switcher, mounted', () {
    // A phone, and the real widget — the arrangement
    // `session_switcher_mount_test.dart` establishes for this surface,
    // because the switcher only exists inside `ChatWidget`'s own app bar and
    // its popover only behaves at a real width.
    const Size phone = Size(400, 800);
    Finder toggle() => find.byIcon(Icons.list_rounded);

    Future<void> pumpConversation(WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: ChatWidget(cubit: cubit)));
      // The app bar exists only on a drill-down, so arrive the way a
      // customer does.
      cubit.openConversation('live_one');
      await tester.pumpAndSettle();
    }

    testWidgets('is not offered at all when the only other one is closed',
        (WidgetTester tester) async {
      // The caller's gate is `sessions.length > 0` over the list the
      // customer can actually see. Asked over the raw page it puts a toggle
      // in the header that opens onto "No other conversations yet." — a
      // control offering a choice that is not there.
      await pumpConversation(tester);
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 'closed_one', status: ChatStatus.closed),
      ]);
      await tester.pumpAndSettle();

      expect(find.byType(SessionSwitcher), findsNothing);
      expect(toggle(), findsNothing);
    });

    testWidgets('lists the resolved one and not the closed one',
        (WidgetTester tester) async {
      await pumpConversation(tester);
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 'closed_one', status: ChatStatus.closed),
        _summary(id: 'resolved_one', status: ChatStatus.resolved),
      ]);
      await tester.pumpAndSettle();

      await tester.tap(toggle());
      await tester.pumpAndSettle();

      expect(find.byType(SessionRow), findsOneWidget);
      expect(
          find.byKey(const ValueKey<String>('resolved_one')), findsOneWidget);
      expect(find.byKey(const ValueKey<String>('closed_one')), findsNothing);
    });
  });

  group('the Messages tab badge', () {
    testWidgets('counts only what the customer can go and read',
        (WidgetTester tester) async {
      // A badge is a promise that there is something behind the tab. Summing
      // a conversation this widget no longer lists leaves a count that
      // cannot be explained by anything on the screen it points at, and no
      // way for the customer to clear it.
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 'open_one', status: ChatStatus.open, unreadCount: 2),
        _summary(id: 'closed_one', status: ChatStatus.closed, unreadCount: 5),
      ]);
      await tester.pumpWidget(MaterialApp(home: ChatWidget(cubit: cubit)));
      await tester.pumpAndSettle();

      expect(
        find.descendant(of: find.byType(Badge), matching: find.text('2')),
        findsOneWidget,
      );
      expect(find.text('7'), findsNothing);
      // And the RECORD is untouched: `unreadCount` is still the sum over the
      // whole page — what the host handed over, which is a different fact
      // from what the customer is offered and is not narrowed by a display
      // rule.
      //
      // It is no longer what the reply chime watches, though. Asked whether
      // a sound should keep announcing a conversation that moves no badge,
      // shows no row and leads nowhere, the user narrowed the chime to the
      // same count as the badge; `chime_mount_test.dart`'s three closed-
      // conversation cases are where that is pinned, on the widget that
      // owns the listener.
      expect(cubit.state.unreadCount, 7);
    });
  });

  group('the conversation the customer is IN is the exception', () {
    testWidgets('a session closed under the customer keeps its row',
        (WidgetTester tester) async {
      // The list rebuilds the moment `session.updated` lands, so a
      // conversation can be closed while it is being read. Pulling its row
      // out from under someone mid-tap is a worse failure than showing one
      // finished row.
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(
            id: 'being_read',
            status: ChatStatus.closed,
            subject: 'The one on screen'),
      ]);
      client.emitSession(
          testSession(id: 'being_read', status: ChatStatus.closed));
      await tester.pumpWidget(wrapMessages());
      await flush(tester);

      expect(cubit.state.session?.sessionId, 'being_read');
      expect(find.text('The one on screen'), findsOneWidget);
    });

    testWidgets('and drops it on the next render once they have left',
        (WidgetTester tester) async {
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(
            id: 'being_read',
            status: ChatStatus.closed,
            subject: 'The one on screen'),
        _summary(id: 'elsewhere', status: ChatStatus.open, subject: 'Elsewhere'),
      ]);
      client.emitSession(
          testSession(id: 'being_read', status: ChatStatus.closed));
      await tester.pumpWidget(wrapMessages());
      await flush(tester);
      expect(find.text('The one on screen'), findsOneWidget);

      // Leaving it: the next snapshot names a different conversation, which
      // is the only thing that makes one "the one they are in".
      client.emitSession(testSession(id: 'elsewhere'));
      await flush(tester);

      expect(cubit.state.session?.sessionId, 'elsewhere');
      expect(find.text('The one on screen'), findsNothing);
      expect(find.text('Elsewhere'), findsOneWidget);
    });
  });
}
