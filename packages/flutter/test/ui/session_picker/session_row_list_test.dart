// Reproduces `session-picker.test.ts`'s row-family assertions — the ones
// both surfaces inherit rather than restate:
//
//   * "renders status, time, preview, handledBy, and unreadCount per row"
//   * "hides the handledBy and unread fragments when absent"
//   * "is never a second guest heuristic — it renders exactly what it is given"
//   * "shows an empty state, not an error, when there are no sessions"
//   * "a terminal (CLOSED|RESOLVED) row is a real, enabled control"
//   * "calls onSelect with the picked session id"
//   * "reuses the same row element across renders, keyed by id"
//   * "drops a row for a session no longer in the list"
//   * "disables and relabels the start-new control while busy"
//   * the status table: every backend status renders distinctly
//
// The DOM mechanics do not transfer — there is no `hidden` attribute to
// assert, so a fragment with no fact behind it is ABSENT rather than present
// and hidden, and "the same element" is a Flutter `Element` identity rather
// than a node reference.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

const HandledBy _ada = HandledBy(
  kind: HandledByKind.agent,
  id: 'agt_1',
  displayName: 'Ada',
);

ChatSessionSummary _summary({
  String id = 's1',
  ChatStatus status = ChatStatus.assigned,
  String? preview = 'Where is my order?',
  HandledBy? handledBy,
  int unreadCount = 0,
}) {
  return ChatSessionSummary(
    id: id,
    status: status,
    mode: ChatMode.human,
    createdAt: DateTime.utc(2026, 8, 19, 9),
    lastMessageAt: DateTime.utc(2026, 8, 19, 10),
    lastMessagePreview: preview,
    handledBy: handledBy,
    unreadCount: unreadCount,
  );
}

Widget _wrapList({
  required List<ChatSessionSummary> sessions,
  String? currentSessionId,
  ValueChanged<String>? onSelect,
}) {
  return MaterialApp(
    home: Scaffold(
      body: SessionRowList(
        sessions: sessions,
        currentSessionId: currentSessionId,
        onSelect: onSelect ?? (_) {},
        listLabel: 'Recent conversations',
        emptyText: 'No previous conversations yet.',
      ),
    ),
  );
}

void main() {
  group('SessionRowList — what a row shows', () {
    testWidgets('status, time, preview, handledBy and unread all render',
        (WidgetTester tester) async {
      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[
          _summary(handledBy: _ada, unreadCount: 3),
        ],
      ));

      expect(find.text('With an agent'), findsOneWidget);
      expect(find.text('Where is my order?'), findsOneWidget);
      expect(find.text('with Ada'), findsOneWidget);
      expect(find.text('3 unread'), findsOneWidget);
    });

    testWidgets(
        'the fragments with no fact behind them are absent, not blank labels',
        (WidgetTester tester) async {
      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[_summary(preview: null)],
      ));

      // `handledBy` is null and `unreadCount` is 0 — neither renders at all.
      expect(find.textContaining('with '), findsNothing);
      expect(find.textContaining('unread'), findsNothing);
      expect(find.text(''), findsNothing);
    });

    testWidgets('every backend status renders its own word',
        (WidgetTester tester) async {
      // The named regression: an earlier version treated anything that was
      // not CLOSED as "live", which showed RESOLVED sessions as active.
      const Map<ChatStatus, String> expected = <ChatStatus, String>{
        ChatStatus.open: 'Open',
        ChatStatus.waitingForAgent: 'Waiting for an agent',
        ChatStatus.assigned: 'With an agent',
        ChatStatus.onHold: 'On hold',
        ChatStatus.resolved: 'Resolved',
        ChatStatus.closed: 'Closed',
      };

      for (final MapEntry<ChatStatus, String> entry in expected.entries) {
        await tester.pumpWidget(_wrapList(
          sessions: <ChatSessionSummary>[
            _summary(status: entry.key, preview: null),
          ],
        ));
        expect(find.text(entry.value), findsOneWidget, reason: '${entry.key}');
      }
    });

    testWidgets('the spoken account is the composed one, not the visible spans',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[
          _summary(handledBy: _ada, unreadCount: 3),
        ],
      ));

      final SemanticsNode node = tester.getSemantics(find.byType(SessionRow));
      // The row's own label carries every fact...
      expect(node.label, contains('With an agent'));
      expect(node.label, contains('with Ada'));
      expect(node.label, contains('Where is my order?'));
      // ...spelled out, where the badge abbreviates to "3 unread".
      expect(node.label, contains('3 unread messages'));
      expect(node.label, isNot(contains('3 unread,')));
      handle.dispose();
    });
  });

  group('SessionRowList — an empty list', () {
    testWidgets('renders an empty-state row, never a hidden component',
        (WidgetTester tester) async {
      await tester.pumpWidget(_wrapList(sessions: <ChatSessionSummary>[]));

      expect(find.text('No previous conversations yet.'), findsOneWidget);
      expect(find.byType(SessionRow), findsNothing);
      // The list widget itself is still on screen. Deciding whether the
      // SURFACE shows is `sessions.length > 0`, asked by the caller.
      expect(find.byType(SessionRowList), findsOneWidget);
    });

    testWidgets('renders exactly what it is given, both ways round',
        (WidgetTester tester) async {
      // This module makes no guest heuristic of its own: one session in, one
      // row out; none in, none out.
      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[_summary()],
      ));
      expect(find.byType(SessionRow), findsOneWidget);

      await tester.pumpWidget(_wrapList(sessions: <ChatSessionSummary>[]));
      expect(find.byType(SessionRow), findsNothing);
    });
  });

  group('SessionRowList — picking', () {
    for (final ChatStatus status in <ChatStatus>[
      ChatStatus.closed,
      ChatStatus.resolved,
    ]) {
      testWidgets('a terminal ($status) row is a real, enabled control',
          (WidgetTester tester) async {
        final List<String> picked = <String>[];
        await tester.pumpWidget(_wrapList(
          sessions: <ChatSessionSummary>[
            _summary(id: 'terminal-1', status: status),
          ],
          onSelect: picked.add,
        ));

        // Not merely "tappable in principle": the control underneath carries
        // a live handler, which is what `disabled` would have removed.
        final InkWell ink = tester.widget<InkWell>(
          find.descendant(
            of: find.byType(SessionRow),
            matching: find.byType(InkWell),
          ),
        );
        expect(ink.onTap, isNotNull);

        await tester.tap(find.byType(SessionRow));
        await tester.pump();
        expect(picked, <String>['terminal-1']);
      });
    }

    testWidgets('never announces itself as disabled, whatever the status',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[
          _summary(id: 'c', status: ChatStatus.closed),
        ],
      ));

      final SemanticsNode node = tester.getSemantics(find.byType(SessionRow));
      // No enabled/disabled state at all, rather than a state set to true:
      // a reader can only announce "dimmed" for a control that HAS one.
      expect(node.hasFlag(SemanticsFlag.hasEnabledState), isFalse);
      handle.dispose();
    });

    testWidgets('calls onSelect with the picked session id',
        (WidgetTester tester) async {
      final List<String> picked = <String>[];
      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[_summary(id: 'sess_42')],
        onSelect: picked.add,
      ));

      await tester.tap(find.byType(SessionRow));
      await tester.pump();
      expect(picked, <String>['sess_42']);
    });

    testWidgets('marks the current conversation and leaves the others alone',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[_summary(id: 'a'), _summary(id: 'b')],
        currentSessionId: 'b',
      ));

      SemanticsNode nodeFor(String id) =>
          tester.getSemantics(find.byKey(ValueKey<String>(id)));

      expect(nodeFor('a').hasFlag(SemanticsFlag.isSelected), isFalse);
      expect(nodeFor('b').hasFlag(SemanticsFlag.isSelected), isTrue);
      expect(nodeFor('b').label, contains('current conversation'));
      expect(nodeFor('a').label, isNot(contains('current conversation')));

      // Marked, not disabled — the current row stays pickable.
      expect(nodeFor('b').hasFlag(SemanticsFlag.hasEnabledState), isFalse);
      handle.dispose();
    });
  });

  group('SessionRowList — reuse across renders', () {
    testWidgets('reuses the same row element, keyed by id',
        (WidgetTester tester) async {
      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[_summary(id: 'a')],
      ));
      final Element first = tester.element(find.byKey(const ValueKey<String>('a')));

      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[_summary(id: 'a', unreadCount: 1)],
      ));
      expect(
        tester.element(find.byKey(const ValueKey<String>('a'))),
        same(first),
      );
      expect(find.text('1 unread'), findsOneWidget);
    });

    testWidgets('drops the row for a session no longer in the list',
        (WidgetTester tester) async {
      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[_summary(id: 'a'), _summary(id: 'b')],
      ));
      expect(find.byType(SessionRow), findsNWidgets(2));

      await tester.pumpWidget(_wrapList(
        sessions: <ChatSessionSummary>[_summary(id: 'a')],
      ));
      expect(find.byType(SessionRow), findsOneWidget);
      expect(find.byKey(const ValueKey<String>('b')), findsNothing);
    });
  });

  group('SessionStartNewButton', () {
    testWidgets('calls back when pressed', (WidgetTester tester) async {
      int calls = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SessionStartNewButton(onStartNew: () => calls += 1),
        ),
      ));

      await tester.tap(find.text(kStartNewConversationLabel));
      await tester.pump();
      expect(calls, 1);
    });

    testWidgets('disables AND relabels while busy, then restores both',
        (WidgetTester tester) async {
      Widget build(bool busy) => MaterialApp(
            home: Scaffold(
              body: SessionStartNewButton(onStartNew: () {}, busy: busy),
            ),
          );

      await tester.pumpWidget(build(true));
      expect(find.text(kStartingNewConversationLabel), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );

      await tester.pumpWidget(build(false));
      expect(find.text(kStartNewConversationLabel), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNotNull,
      );
    });
  });
}
