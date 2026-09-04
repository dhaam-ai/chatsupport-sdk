// Reproduces `session-picker.test.ts`'s `createSessionSwitcher` block:
//
//   * "starts closed: panel hidden, toggle unexpanded"
//   * "the toggle names itself, announces the popup, and points at the panel"
//   * "opens on click, moving focus into the popover"
//   * "marks the current session distinctly from the others"
//   * "closes and returns focus to the toggle on Escape"
//   * "closes on a pointerdown outside the component"
//   * "does NOT close on a pointerdown inside its own panel"
//   * "picking a session closes the popover and calls onSelect"
//   * "starting a new conversation from inside also closes the popover"
//   * "destroy() removes the outside-pointerdown listener"
//
// Two of those change shape rather than transferring literally. `isOpen()`
// is asserted as "is the panel on screen", which is the thing the customer
// can actually see. And `destroy()` has no counterpart: Flutter's listener
// is scoped to the widget rather than registered on a document, so the
// assertion becomes "unmounting an OPEN switcher tears it down cleanly and a
// later press hits nothing" — the harm the JS test was guarding against.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

ChatSessionSummary _summary({
  String id = 's1',
  ChatStatus status = ChatStatus.assigned,
}) =>
    ChatSessionSummary(
      id: id,
      status: status,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 8, 19, 9),
      lastMessageAt: DateTime.utc(2026, 8, 19, 10),
      lastMessagePreview: 'Where is my order?',
    );

Widget _wrap({
  List<ChatSessionSummary> sessions = const <ChatSessionSummary>[],
  String? currentSessionId,
  ValueChanged<String>? onSelect,
  VoidCallback? onStartNew,
  bool mounted = true,
}) {
  return MaterialApp(
    home: Scaffold(
      body: Column(
        children: <Widget>[
          // Somewhere unambiguously outside the switcher to press.
          const SizedBox(height: 200, width: 400, child: Text('outside')),
          if (mounted)
            SessionSwitcher(
              sessions: sessions,
              currentSessionId: currentSessionId,
              onSelect: onSelect ?? (_) {},
              onStartNew: onStartNew ?? () {},
            ),
        ],
      ),
    ),
  );
}

Finder get _toggle => find.byIcon(Icons.list_rounded);
bool get _panelIsOpen => find.byType(SessionStartNewButton).evaluate().isNotEmpty;

/// Whether keyboard focus sits on something inside [finder] — see
/// `session_picker_screen_test.dart` for why the focus manager has to be
/// asked rather than the widget.
bool _focusIsInside(WidgetTester tester, Finder finder) {
  final BuildContext? focused = FocusManager.instance.primaryFocus?.context;
  if (focused == null) return false;
  final Element target = tester.element(finder);
  bool inside = false;
  focused.visitAncestorElements((Element ancestor) {
    if (!identical(ancestor, target)) return true;
    inside = true;
    return false;
  });
  return inside;
}

Future<void> _openIt(WidgetTester tester) async {
  await tester.tap(_toggle);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('starts closed — no panel, and the toggle says so',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(_wrap(sessions: <ChatSessionSummary>[_summary()]));

    expect(_panelIsOpen, isFalse);
    expect(find.byType(SessionRow), findsNothing);
    expect(
      tester.getSemantics(_toggle).hasFlag(SemanticsFlag.isExpanded),
      isFalse,
    );
    handle.dispose();
  });

  testWidgets('the toggle names itself rather than being a bare glyph',
      (WidgetTester tester) async {
    await tester.pumpWidget(_wrap(sessions: <ChatSessionSummary>[_summary()]));

    expect(
      tester.widget<IconButton>(find.byType(IconButton)).tooltip,
      kSessionSwitcherToggleLabel,
    );
  });

  testWidgets('opens on tap, says it is expanded, and moves focus into itself',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(
      _wrap(sessions: <ChatSessionSummary>[_summary(id: 'a')]),
    );

    await _openIt(tester);

    expect(_panelIsOpen, isTrue);
    expect(find.byType(SessionRow), findsOneWidget);
    expect(
      tester.getSemantics(_toggle).hasFlag(SemanticsFlag.isExpanded),
      isTrue,
    );
    // A menu a keyboard user has just summoned but cannot reach without
    // tabbing to it is not open to them.
    expect(
      _focusIsInside(tester, find.byKey(const ValueKey<String>('a'))),
      isTrue,
    );
    handle.dispose();
  });

  testWidgets('focus lands on the start control when there are no rows',
      (WidgetTester tester) async {
    await tester.pumpWidget(_wrap());
    await _openIt(tester);

    expect(find.text(kSessionSwitcherEmptyText), findsOneWidget);
    expect(_focusIsInside(tester, find.byType(SessionStartNewButton)), isTrue);
  });

  testWidgets('marks the current session distinctly from the others',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(_wrap(
      sessions: <ChatSessionSummary>[_summary(id: 'a'), _summary(id: 'b')],
      currentSessionId: 'b',
    ));
    await _openIt(tester);

    SemanticsNode nodeFor(String id) =>
        tester.getSemantics(find.byKey(ValueKey<String>(id)));

    expect(nodeFor('a').hasFlag(SemanticsFlag.isSelected), isFalse);
    expect(nodeFor('b').hasFlag(SemanticsFlag.isSelected), isTrue);
    expect(nodeFor('b').label, contains('current conversation'));
    handle.dispose();
  });

  group('the three ways it closes', () {
    testWidgets('Escape closes it AND returns focus to the toggle',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(sessions: <ChatSessionSummary>[_summary(id: 'a')]),
      );
      await _openIt(tester);
      expect(_panelIsOpen, isTrue);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();

      expect(_panelIsOpen, isFalse);
      // Focus back where the customer left it, not stranded on nothing.
      expect(_focusIsInside(tester, find.byType(IconButton)), isTrue);
    });

    testWidgets('a press outside closes it', (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(sessions: <ChatSessionSummary>[_summary(id: 'a')]),
      );
      await _openIt(tester);
      expect(_panelIsOpen, isTrue);

      await tester.tapAt(tester.getCenter(find.text('outside')));
      await tester.pumpAndSettle();

      expect(_panelIsOpen, isFalse);
    });

    testWidgets('a press INSIDE its own panel does NOT close it',
        (WidgetTester tester) async {
      // The bug this guards: a dismissal that fires on a press inside the
      // panel closes the popover mid-press and swallows the tap it was
      // producing, so a row can never be picked at all.
      await tester.pumpWidget(
        _wrap(sessions: <ChatSessionSummary>[_summary(id: 'a')]),
      );
      await _openIt(tester);

      // The panel's own padding, between the list and the start control —
      // inside the popover, on no control of its own.
      await tester.tapAt(
        tester.getTopLeft(find.byType(SessionStartNewButton)) +
            const Offset(-4, -4),
      );
      await tester.pumpAndSettle();

      expect(_panelIsOpen, isTrue);
    });

    testWidgets('the toggle closes it again and returns focus',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(sessions: <ChatSessionSummary>[_summary(id: 'a')]),
      );
      await _openIt(tester);
      expect(_panelIsOpen, isTrue);

      await tester.tap(_toggle);
      await tester.pumpAndSettle();

      expect(_panelIsOpen, isFalse);
      expect(_focusIsInside(tester, find.byType(IconButton)), isTrue);
    });
  });

  group('picking from inside', () {
    testWidgets('picking a session closes the popover and reports the id',
        (WidgetTester tester) async {
      final List<String> picked = <String>[];
      await tester.pumpWidget(_wrap(
        sessions: <ChatSessionSummary>[_summary(id: 'pick-me')],
        onSelect: picked.add,
      ));
      await _openIt(tester);

      await tester.tap(find.byType(SessionRow));
      await tester.pumpAndSettle();

      expect(picked, <String>['pick-me']);
      // A customer who just switched should see the switch, not the menu
      // they picked it from still hanging over the top of it.
      expect(_panelIsOpen, isFalse);
    });

    testWidgets('the current row is pickable too, not a dead control',
        (WidgetTester tester) async {
      final List<String> picked = <String>[];
      await tester.pumpWidget(_wrap(
        sessions: <ChatSessionSummary>[_summary(id: 'here')],
        currentSessionId: 'here',
        onSelect: picked.add,
      ));
      await _openIt(tester);

      await tester.tap(find.byType(SessionRow));
      await tester.pumpAndSettle();

      expect(picked, <String>['here']);
    });

    testWidgets('a terminal row is pickable too — reactivation is a real path',
        (WidgetTester tester) async {
      final List<String> picked = <String>[];
      await tester.pumpWidget(_wrap(
        sessions: <ChatSessionSummary>[
          _summary(id: 'closed_one', status: ChatStatus.closed),
        ],
        onSelect: picked.add,
      ));
      await _openIt(tester);

      expect(find.text('Closed'), findsOneWidget);
      await tester.tap(find.byType(SessionRow));
      await tester.pumpAndSettle();

      expect(picked, <String>['closed_one']);
    });

    testWidgets('starting a new conversation from inside also closes it',
        (WidgetTester tester) async {
      int starts = 0;
      await tester.pumpWidget(_wrap(
        sessions: <ChatSessionSummary>[_summary(id: 'a')],
        onStartNew: () => starts += 1,
      ));
      await _openIt(tester);

      await tester.tap(find.text(kStartNewConversationLabel));
      await tester.pumpAndSettle();

      expect(starts, 1);
      expect(_panelIsOpen, isFalse);
    });
  });

  testWidgets('unmounting while open tears down cleanly, and a later press '
      'reaches nothing', (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(sessions: <ChatSessionSummary>[_summary(id: 'a')]),
    );
    await _openIt(tester);
    expect(_panelIsOpen, isTrue);

    await tester.pumpWidget(_wrap(mounted: false));
    await tester.pumpAndSettle();

    expect(find.byType(SessionSwitcher), findsNothing);
    expect(_panelIsOpen, isFalse);
    // The JS version had to remove a `document` listener by hand, or it
    // would fire against a torn-down component on some OTHER widget
    // instance's future clicks. Here the region goes with the widget.
    await tester.tapAt(tester.getCenter(find.text('outside')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
