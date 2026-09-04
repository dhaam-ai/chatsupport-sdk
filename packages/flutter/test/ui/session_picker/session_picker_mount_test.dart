// Reproduces the transferable half of `session-picker-mount.test.ts` and
// `session-switch.test.ts` — both picker surfaces wired to a real
// `ChatWidgetCubit`, rather than to spies.
//
// ── What transfers, and what does not ────────────────────────────────────
//
// TRANSFERS: the gate is exactly `sessions.length > 0` and is asked by the
// caller; a terminal row stays pickable; picking JOINS the chosen session
// and puts the conversation back on screen at once; picking does NOT
// optimistically flip a terminal session to open; the current conversation
// is marked.
//
// DOES NOT: everything `session-switch.test.ts` asserts about the rendered
// TRANSCRIPT swapping — page-one being refetched with no cursor from the old
// session, and the choice surviving a reload. Those are core and history
// concerns (`dhaam_chat` plus the REST history adapter), not the picker's,
// and this package's `WidgetChatClient.joinSession` is a frame write with no
// history behaviour behind it. Nor does "reports a refused switch instead of
// leaking an unhandled rejection": `joinSession` returns no future here, so
// there is no rejection to leak.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';

ChatSessionSummary _summary({
  String id = 'sess_past',
  ChatStatus status = ChatStatus.resolved,
}) =>
    ChatSessionSummary(
      id: id,
      status: status,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 8, 19, 9),
      lastMessageAt: DateTime.utc(2026, 8, 19, 9, 30),
      lastMessagePreview: 'Thanks!',
    );

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

  /// Mounts [child] over the live Cubit, rebuilding it on every state — the
  /// way a real mounting layer does, rather than snapshotting the state once
  /// at construction and leaving the test to get its ordering right.
  Widget mount(Widget Function(ChatWidgetState state) child) {
    return MaterialApp(
      home: Scaffold(
        body: BlocProvider<ChatWidgetCubit>.value(
          value: cubit,
          child: BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
            builder: (BuildContext context, ChatWidgetState state) =>
                child(state),
          ),
        ),
      ),
    );
  }

  /// The picker screen, wired to the Cubit exactly as a mounting layer would.
  Widget mountScreen() {
    return mount(
      (ChatWidgetState state) => SessionPickerScreen(
        sessions: state.sessionSummaries,
        onSelect: cubit.selectSession,
        onStartNew: cubit.startNewConversation,
        cornerRadius: chatCornerRadius(state.config),
      ),
    );
  }

  group('the gate is exactly sessions.length > 0, and the caller asks it', () {
    testWidgets('an empty page renders the surface, with no rows — a guest',
        (WidgetTester tester) async {
      await tester.pumpWidget(mountScreen());

      // Not a hidden component: the surface is complete and says so.
      expect(find.byType(SessionPickerScreen), findsOneWidget);
      expect(find.byType(SessionRow), findsNothing);
      expect(find.text(kSessionPickerEmptyText), findsOneWidget);
      expect(find.text(kStartNewConversationLabel), findsOneWidget);
    });

    testWidgets('one row per session', (WidgetTester tester) async {
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 'a'),
        _summary(id: 'b'),
      ]);
      await tester.pumpWidget(mountScreen());

      expect(find.byType(SessionRow), findsNWidgets(2));
    });

    testWidgets('keeps a terminal session pickable — reactivation is a path',
        (WidgetTester tester) async {
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 'closed_one', status: ChatStatus.closed),
      ]);
      await tester.pumpWidget(mountScreen());

      expect(find.text('Closed'), findsOneWidget);
      await tester.tap(find.byType(SessionRow));
      await tester.pump();

      expect(client.joinedSessionIds, <String>['closed_one']);
    });
  });

  group('picking a conversation', () {
    testWidgets('joins the chosen session and shows the conversation at once',
        (WidgetTester tester) async {
      cubit.updateSessionSummaries(<ChatSessionSummary>[_summary()]);
      await tester.pumpWidget(mountScreen());

      await tester.tap(find.byType(SessionRow));
      await tester.pump();

      expect(client.joinedSessionIds, <String>['sess_past']);
      // The pane flips straight away rather than on completion: holding the
      // picker up for a round trip would read as a dead tap.
      expect(cubit.state.screen, ScreenName.conversation);
      // The picker IS one of the places the widget deliberately puts a
      // conversation in front of the customer, so the pre-chat gate can arm.
      expect(cubit.state.conversationOpened, isTrue);
    });

    testWidgets('does not optimistically flip a terminal session to open',
        (WidgetTester tester) async {
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 'sess_past', status: ChatStatus.closed),
      ]);
      await tester.pumpWidget(mountScreen());

      final SessionSnapshot? before = cubit.state.session;
      await tester.tap(find.byType(SessionRow));
      await tester.pump();

      // The server reactivates on the customer's next message, behind a flag
      // that defaults to OFF. Guessing locally would show a live
      // conversation on a deployment where reactivation never happens.
      expect(cubit.state.session, same(before));
    });

    testWidgets('goes through the same funnel a Messages row does',
        (WidgetTester tester) async {
      // `selectSession` is a forwarder to `openConversation`, so a picker row
      // and a Messages row cannot diverge on what picking means. Asserted by
      // driving both and comparing the state each leaves behind.
      cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(id: 'x')]);
      await tester.pumpWidget(mountScreen());

      await tester.tap(find.byType(SessionRow));
      await tester.pump();
      final ChatWidgetState afterPicker = cubit.state;

      cubit.openConversation('x');
      expect(cubit.state, afterPicker);
      expect(client.joinedSessionIds, <String>['x', 'x']);
    });

    testWidgets('discards a surface left open on the way in',
        (WidgetTester tester) async {
      // Asking for a DIFFERENT conversation is one of the two moments that
      // mean "I am done with this". Without the discard the new conversation
      // is drawn UNDER a stale form.
      cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(id: 'x')]);
      cubit.startNewConversation();
      expect(cubit.state.activeSurface, isA<ComposingNewSurface>());

      await tester.pumpWidget(mountScreen());
      await tester.tap(find.byType(SessionRow));
      await tester.pump();

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.composingNew, isFalse);
    });
  });

  group('the switcher, mounted in a conversation', () {
    // Centred, not flush against the edge. The popover is anchored to the
    // toggle's right edge and is 300 wide, so a toggle in the top-left
    // corner puts most of its own panel off-screen — where a tap on a row
    // hit-tests nothing. A header places this with room around it; a test
    // that does not is testing a layout no host would ship.
    Widget mountSwitcher() {
      return mount(
        (ChatWidgetState state) => Center(
          child: SessionSwitcher(
            sessions: state.sessionSummaries,
            currentSessionId: state.session?.sessionId,
            onSelect: cubit.selectSession,
            onStartNew: cubit.startNewConversation,
          ),
        ),
      );
    }

    testWidgets('marks the conversation the customer is in, and joins another',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pumpWidget(mountSwitcher());

      // The snapshot arrives on a stream, so its listener runs on a
      // microtask. `pump` is what flushes those — an `await Future.delayed`
      // here would hang forever, because `testWidgets` runs the body in a
      // fake-async zone whose clock only advances when the test pumps.
      client.emitSession(testSession(id: 'sess_current'));
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 'sess_current', status: ChatStatus.assigned),
        _summary(id: 'other'),
      ]);
      await tester.pump();

      await tester.tap(find.byIcon(Icons.list_rounded));
      await tester.pumpAndSettle();

      expect(
        tester
            .getSemantics(find.byKey(const ValueKey<String>('sess_current')))
            .label,
        contains('current conversation'),
      );

      await tester.tap(find.byKey(const ValueKey<String>('other')));
      await tester.pumpAndSettle();

      expect(client.joinedSessionIds, <String>['other']);
      expect(cubit.state.screen, ScreenName.conversation);
      handle.dispose();
    });

    testWidgets('starting fresh from inside mints rather than joins',
        (WidgetTester tester) async {
      // The distinction that matters: joining drops the customer into
      // whichever conversation the server picked, not the fresh one they
      // asked for.
      cubit.updateSessionSummaries(<ChatSessionSummary>[_summary()]);
      await tester.pumpWidget(mountSwitcher());
      await tester.tap(find.byIcon(Icons.list_rounded));
      await tester.pumpAndSettle();

      await tester.tap(find.text(kStartNewConversationLabel));
      await tester.pumpAndSettle();

      expect(client.joinedSessionIds, isEmpty);
      expect(cubit.state.activeSurface, isA<ComposingNewSurface>());
      // A form opened from the switcher is a detour, not a conversation —
      // counting it would arm the pre-chat gate behind the very form that is
      // already asking those questions.
      expect(cubit.state.conversationOpened, isFalse);
    });
  });
}
