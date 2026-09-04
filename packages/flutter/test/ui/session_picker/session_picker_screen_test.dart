// Reproduces `session-picker.test.ts`'s `createPreChatScreen` block:
//
//   * "labels itself and its list for a screen reader"
//   * "shows an empty state, not an error, when there are no sessions"
//   * "calls onStartNew from the always-available start control"
//   * "disables and relabels the start-new control while busy"
//   * "moves focus to the first row on open when sessions exist, else to
//      start new"
//
// The per-row assertions live in `session_row_list_test.dart` — this surface
// owns its chrome and its focus order, and inherits everything else.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

ChatSessionSummary _summary({String id = 's1'}) => ChatSessionSummary(
      id: id,
      status: ChatStatus.assigned,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 8, 19, 9),
      lastMessageAt: DateTime.utc(2026, 8, 19, 10),
      lastMessagePreview: 'Where is my order?',
    );

Widget _wrap({
  required List<ChatSessionSummary> sessions,
  ValueChanged<String>? onSelect,
  VoidCallback? onStartNew,
  bool isStartingNew = false,
  bool autofocus = false,
}) {
  return MaterialApp(
    home: Scaffold(
      body: SessionPickerScreen(
        sessions: sessions,
        onSelect: onSelect ?? (_) {},
        onStartNew: onStartNew ?? () {},
        isStartingNew: isStartingNew,
        autofocus: autofocus,
      ),
    ),
  );
}

/// Whether keyboard focus currently sits on something inside [finder].
///
/// `InkWell(autofocus:)` and `FilledButton(autofocus:)` both build their own
/// internal [FocusNode], so there is no node to read off the widget — the
/// question has to be asked of the focus manager and answered by walking the
/// element tree back up to the subtree under test.
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

void main() {
  testWidgets('labels itself and its list for a screen reader',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(_wrap(sessions: <ChatSessionSummary>[_summary()]));

    expect(
      tester.getSemantics(find.byType(SessionPickerScreen)).label,
      contains(kSessionPickerHeading),
    );
    // The heading is a heading, not just large text — that is what lets a
    // reader jump to it.
    expect(
      tester
          .getSemantics(find.text(kSessionPickerHeading))
          .hasFlag(SemanticsFlag.isHeader),
      isTrue,
    );
    handle.dispose();
  });

  testWidgets('shows an empty state and its start control, not an error',
      (WidgetTester tester) async {
    await tester.pumpWidget(_wrap(sessions: <ChatSessionSummary>[]));

    expect(find.text(kSessionPickerEmptyText), findsOneWidget);
    expect(find.byType(SessionRow), findsNothing);
    // The screen is complete and usable: it says there is nothing to pick
    // and offers the one thing there is to do.
    expect(find.text(kStartNewConversationLabel), findsOneWidget);
    expect(find.text(kSessionPickerHeading), findsOneWidget);
  });

  testWidgets('marks no row — this surface has no current conversation',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(_wrap(
      sessions: <ChatSessionSummary>[_summary(id: 'a'), _summary(id: 'b')],
    ));

    for (final String id in <String>['a', 'b']) {
      final SemanticsNode node =
          tester.getSemantics(find.byKey(ValueKey<String>(id)));
      expect(node.hasFlag(SemanticsFlag.isSelected), isFalse);
      expect(node.label, isNot(contains('current conversation')));
    }
    handle.dispose();
  });

  testWidgets('picking a row reports the id it was rendered for',
      (WidgetTester tester) async {
    final List<String> picked = <String>[];
    await tester.pumpWidget(_wrap(
      sessions: <ChatSessionSummary>[_summary(id: 'sess_42')],
      onSelect: picked.add,
    ));

    await tester.tap(find.byType(SessionRow));
    await tester.pump();
    expect(picked, <String>['sess_42']);
  });

  testWidgets('the start control is available whatever the list holds',
      (WidgetTester tester) async {
    int calls = 0;
    for (final List<ChatSessionSummary> sessions in <List<ChatSessionSummary>>[
      <ChatSessionSummary>[],
      <ChatSessionSummary>[_summary()],
    ]) {
      await tester.pumpWidget(
        _wrap(sessions: sessions, onStartNew: () => calls += 1),
      );
      await tester.tap(find.text(kStartNewConversationLabel));
      await tester.pump();
    }
    expect(calls, 2);
  });

  testWidgets('goes busy on the start control so one round trip mints once',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _wrap(sessions: <ChatSessionSummary>[_summary()], isStartingNew: true),
    );

    expect(find.text(kStartingNewConversationLabel), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
  });

  group('focus lands on the first meaningful control', () {
    testWidgets('the first row, when there are sessions',
        (WidgetTester tester) async {
      await tester.pumpWidget(_wrap(
        sessions: <ChatSessionSummary>[_summary(id: 'a'), _summary(id: 'b')],
        autofocus: true,
      ));
      await tester.pump();

      expect(
        _focusIsInside(tester, find.byKey(const ValueKey<String>('a'))),
        isTrue,
      );
      expect(
        _focusIsInside(tester, find.byKey(const ValueKey<String>('b'))),
        isFalse,
      );
    });

    testWidgets('"start a new conversation", when there are none',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(sessions: <ChatSessionSummary>[], autofocus: true),
      );
      await tester.pump();

      expect(
        _focusIsInside(tester, find.byType(SessionStartNewButton)),
        isTrue,
      );
    });
  });
}
