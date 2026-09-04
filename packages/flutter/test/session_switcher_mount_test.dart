/// The in-chat session switcher, MOUNTED — D39's gap.
///
/// `session_switcher_test.dart` already pins everything the component decides
/// (open/close, focus, Escape, outside-press, row selection). It passed for
/// the whole of this run while the switcher was mounted in tests and nowhere
/// else, which is exactly the pattern D38's tally names. What is here is the
/// mounting: the caller's `sessions.length > 0` gate, and the placement that
/// unclamped popover requires.
///
/// ── The reference never mounted it either ────────────────────────────────
///
/// `createSessionSwitcher` (session-picker.ts:288) has no call site in
/// `packages/widget/src`, so there is no TS test block to reproduce here —
/// this file has no counterpart upstream. The gate it asserts is still the
/// reference's own, stated in that file's header: "the client rule is exactly
/// `sessions.length > 0` ⇒ show the picker", decided by the caller.
library;

// `ChatStatus`/`ChatMode` are protocol types, so this suite needs both
// barrels. The only collision between them is `ConnectionState`, which
// nothing here uses — hidden rather than resolved either way.
import 'package:dhaam_chat/dhaam_chat.dart' hide ConnectionState;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'state/fake_widget_chat_client.dart';
import 'support/remote_config_fixtures.dart';

/// A narrow panel — a phone, which is where an unclamped 300px popover
/// actually falls off the edge. At the 800px test default the bug hides.
const Size _phone = Size(400, 800);

/// The switcher's own toggle — the same finder `session_switcher_test.dart`
/// uses, so both suites name the control the same way.
Finder get _toggle => find.byIcon(Icons.list_rounded);

ChatSessionSummary _summary({String id = 's1'}) => ChatSessionSummary(
      id: id,
      status: ChatStatus.assigned,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 8, 19, 9),
      lastMessageAt: DateTime.utc(2026, 8, 19, 10),
      lastMessagePreview: 'Where is my order?',
    );

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

  /// The popover's painted box — the thing that either fits on screen or
  /// does not.
  ///
  /// Measured at the panel's own [Material], NOT at the
  /// [CompositedTransformFollower] above it: the follower's own render box
  /// sits where the [Positioned] put it (x = 0) and the leftward offset is
  /// applied to its CHILD, so measuring the follower reports 0 for a panel
  /// that is in fact 252px off the left edge. The control below is what
  /// caught that.
  Rect panelRect(WidgetTester tester) => tester.getRect(
        find
            .ancestor(
              of: find.byType(SessionRowList),
              matching: find.byType(Material),
            )
            .first,
      );

  Future<void> pumpPhone(WidgetTester tester) async {
    tester.view.physicalSize = _phone;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: ChatWidget(cubit: cubit)));
  }

  /// The app bar exists only on a drill-down, so every case arrives on the
  /// conversation the way a customer does.
  Future<void> enterConversation(WidgetTester tester) async {
    cubit.openConversation('s1');
    await tester.pumpAndSettle();
  }

  group('the caller gates the mount on sessions.length > 0', () {
    testWidgets('no switcher at all for an empty list — what a guest gets',
        (WidgetTester tester) async {
      await pumpPhone(tester);
      await enterConversation(tester);

      expect(cubit.state.sessionSummaries, isEmpty);
      expect(find.byType(SessionSwitcher), findsNothing);
    });

    testWidgets('mounts once there is a conversation to switch to',
        (WidgetTester tester) async {
      await pumpPhone(tester);
      await enterConversation(tester);
      cubit.updateSessionSummaries(<ChatSessionSummary>[_summary(id: 's1')]);
      await tester.pumpAndSettle();

      expect(find.byType(SessionSwitcher), findsOneWidget);
      expect(_toggle, findsOneWidget);
    });

    // The gate is the LIST, not a guest heuristic re-derived here — the
    // duplication D10 exists to forbid. A signed-in customer with no history
    // gets the same nothing a guest does, for the same one reason.
    testWidgets('drops back out of the header when the list empties',
        (WidgetTester tester) async {
      await pumpPhone(tester);
      await enterConversation(tester);
      cubit.updateSessionSummaries(<ChatSessionSummary>[_summary()]);
      await tester.pumpAndSettle();
      expect(find.byType(SessionSwitcher), findsOneWidget);

      cubit.updateSessionSummaries(const <ChatSessionSummary>[]);
      await tester.pumpAndSettle();

      expect(find.byType(SessionSwitcher), findsNothing);
    });
  });

  // D39/T11's requirement. The panel is 300px wide and anchors
  // `bottomRight → topRight`, so it hangs LEFTWARD from the toggle and does
  // NOT clamp to the viewport: a left-edge toggle puts most of it off-screen,
  // where taps hit nothing. This measures the rendered panel rather than
  // trusting the placement.
  group('the popover lands fully on screen', () {
    testWidgets('opens inside the viewport on a 400px-wide panel',
        (WidgetTester tester) async {
      await pumpPhone(tester);
      await enterConversation(tester);
      cubit.updateSessionSummaries(<ChatSessionSummary>[_summary()]);
      await tester.pumpAndSettle();

      await tester.tap(_toggle);
      await tester.pumpAndSettle();

      final Rect panel = panelRect(tester);
      expect(panel.width, kSessionSwitcherPanelWidth);
      expect(panel.left, greaterThanOrEqualTo(0),
          reason: 'the popover ran off the left edge — the toggle is not '
              'right-aligned enough for an unclamped 300px panel');
      expect(panel.right, lessThanOrEqualTo(_phone.width));
      // And the rows inside it are actually hittable, which is what being
      // on-screen is for.
      expect(find.byType(SessionRow), findsOneWidget);
    });

    // The CONTROL. Without it, "the panel fits" is consistent with the
    // measurement being insensitive — and this run has already been burned
    // once by a component test that stayed green beside a live bug. A
    // LEFT-aligned toggle at the same width must fail the same assertion.
    testWidgets(
        'CONTROL: the same panel DOES run off-screen from a '
        'left-aligned toggle', (WidgetTester tester) async {
      tester.view.physicalSize = _phone;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Align(
              alignment: Alignment.topLeft,
              child: SessionSwitcher(
                sessions: <ChatSessionSummary>[_summary()],
                currentSessionId: 's1',
                onSelect: (_) {},
                onStartNew: () {},
              ),
            ),
          ),
        ),
      );
      await tester.tap(_toggle);
      await tester.pumpAndSettle();

      expect(panelRect(tester).left, lessThan(0));
    });
  });

  group('the switcher drives the same funnels the picker screen does', () {
    testWidgets('picking a row opens that conversation',
        (WidgetTester tester) async {
      await pumpPhone(tester);
      await enterConversation(tester);
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        _summary(id: 's1'),
        _summary(id: 's2'),
      ]);
      await tester.pumpAndSettle();

      await tester.tap(_toggle);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('s2')));
      await tester.pumpAndSettle();

      expect(client.joinedSessionIds, contains('s2'));
      expect(cubit.state.screen, ScreenName.conversation);
    });

    testWidgets('asking to start fresh raises the new-conversation form',
        (WidgetTester tester) async {
      await pumpPhone(tester);
      await enterConversation(tester);
      cubit.updateSessionSummaries(<ChatSessionSummary>[_summary()]);
      await tester.pumpAndSettle();

      await tester.tap(_toggle);
      await tester.pumpAndSettle();
      await tester.tap(find.byType(SessionStartNewButton));
      await tester.pumpAndSettle();

      expect(cubit.state.activeSurface, isA<ComposingNewSurface>());
    });
  });
}
