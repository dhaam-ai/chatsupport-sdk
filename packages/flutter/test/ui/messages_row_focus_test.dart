/// Where keyboard focus goes when the Messages list loses the row holding it.
///
/// ── Why a file of its own ───────────────────────────────────────────────
///
/// `closed_session_hidden_test.dart` owns the RULE — which conversations the
/// customer's surfaces list. This owns a consequence of rebuilding that list
/// at all: a row can disappear under a keyboard user mid-refresh whatever
/// removed it, and the question then is whether anything says so. The two
/// would only share fixtures, not subject matter.
///
/// ── The defect this exists because of ───────────────────────────────────
///
/// These rows used to be built index-wise with NO key. Removing the row at
/// index 0 therefore did not destroy its element — Flutter REUSED it for
/// whatever slid up into the slot, so the focus node survived and the
/// conversation underneath it silently changed. `identical(before, after)`
/// was true: nothing moved.
///
/// That is a defect rather than a convenience, because a focus CHANGE is what
/// assistive technology announces. With no change an AT user is told nothing,
/// their target quietly becomes a different conversation, and Enter opens one
/// they never chose.
///
/// Fixed by keying each row `ValueKey<String>(summary.id)` — which
/// `session_row_list.dart` had been doing all along, for the reason its own
/// comment gives: "a list rebuilt with one session removed must drop THAT
/// row's element rather than reusing it for whatever slid up into its
/// position." Messages was the copy that missed it.
library;

import 'package:dhaam_chat/dhaam_chat.dart' hide ConnectionState;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';

ChatSessionSummary _summary({
  required String id,
  required String subject,
  ChatStatus status = ChatStatus.open,
}) =>
    ChatSessionSummary(
      id: id,
      status: status,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 1, 1),
      lastMessageAt: DateTime.utc(2026, 1, 2),
      subject: subject,
    );

Widget _wrap(ChatWidgetCubit cubit) => BlocProvider<ChatWidgetCubit>.value(
      value: cubit,
      child: const MaterialApp(home: Scaffold(body: MessagesScreen())),
    );

/// The heading text of whatever row currently holds focus, or `none`.
///
/// Messages builds a private row type, so there is no public widget to match
/// on the way [SessionRow] can be matched in the switcher's suites; the
/// nearest enclosing [Material]'s first [Text] is the row's heading.
String focusedRowHeading() {
  final BuildContext? ctx = FocusManager.instance.primaryFocus?.context;
  if (ctx == null) return 'none';
  String? heading;
  ctx.visitAncestorElements((Element element) {
    if (element.widget is Material) {
      final Iterable<Element> texts = find
          .descendant(
            of: find.byWidget(element.widget),
            matching: find.byType(Text),
          )
          .evaluate();
      if (texts.isNotEmpty) {
        heading = (texts.first.widget as Text).data;
        return false;
      }
    }
    return true;
  });
  return heading ?? 'none';
}

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

  /// Tabs off the search field and onto the first row.
  Future<void> focusFirstRow(WidgetTester tester) async {
    for (int i = 0; i < 2; i++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();
    }
  }

  // ── Both halves, and the first is the one that regresses silently ─────
  //
  // Landing spot is also asserted, and honestly: focus goes to the SEARCH
  // FIELD, not to the surviving row. The switcher does better —
  // `session_row_list.dart` re-applies `autofocusFirstRow`, so there focus
  // lands on a real row. Messages has no equivalent and falls back to the
  // first focusable on the screen.
  //
  // The cost is stated rather than glossed: a keyboard user loses their place
  // in the list and must Tab back down. Accepted for now by explicit user
  // decision — focus stays on the screen, and the defect that mattered is
  // gone. LOGGED FOR LATER: make this land on the surviving row as the
  // switcher does. The assertion records today's behaviour and is NOT an
  // endorsement of it; when that lands, change it.
  testWidgets('a real focus change, landing on the search field',
      (WidgetTester tester) async {
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      _summary(id: 'a', subject: 'S-a'),
      _summary(id: 'b', subject: 'S-b'),
    ]);
    await tester.pumpWidget(_wrap(cubit));
    await focusFirstRow(tester);
    expect(focusedRowHeading(), 'S-a');
    final FocusNode? before = FocusManager.instance.primaryFocus;

    // The merchant closes the focused one; the filter drops its row.
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      _summary(id: 'a', subject: 'S-a', status: ChatStatus.closed),
      _summary(id: 'b', subject: 'S-b'),
    ]);
    await tester.pumpAndSettle();

    expect(identical(before, FocusManager.instance.primaryFocus), isFalse,
        reason: 'a DIFFERENT node holds focus — a real focus change, which is '
            'what assistive technology announces. Identical here means the '
            'row key was dropped and the element got reused again');
    expect(focusedRowHeading(), 'Search conversations',
        reason: 'accepted, not ideal — focus stays on the screen but leaves '
            "the list. See this file's header and the note above");
  });

  testWidgets('the surviving row is still the one rendered',
      (WidgetTester tester) async {
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      _summary(id: 'a', subject: 'S-a'),
      _summary(id: 'b', subject: 'S-b'),
    ]);
    await tester.pumpWidget(_wrap(cubit));
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      _summary(id: 'a', subject: 'S-a', status: ChatStatus.closed),
      _summary(id: 'b', subject: 'S-b'),
    ]);
    await tester.pumpAndSettle();

    expect(find.text('S-b'), findsOneWidget);
    expect(find.text('S-a'), findsNothing);
  });
}
