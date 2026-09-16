// `ChatWidget.onClose` — the host's way out of the panel, and the SDK's
// refusal to take it itself.
//
// ── The reported gap ────────────────────────────────────────────────────
//
// "Add in home view or message view in SDK to close — `Navigator.pop`, so it
// will go back to the original screen." There was no close control anywhere
// in `lib/src/`: a host that pushed this widget as a route had no affordance
// to hand the customer, and the bottom nav only moves between this widget's
// own three screens.
//
// ── Why the SDK does not pop ────────────────────────────────────────────
//
// The host wires `Navigator.pop`; this package never calls it. `ChatWidget`
// does not own its route — it may be pushed, it may be a sheet, it may be
// embedded in a page that is never pushed at all (its own library header
// says so, and it mounts no `MaterialApp` and therefore no `Navigator` of
// its own). Popping a route it did not push is how a widget dismisses
// somebody else's screen. `automaticallyImplyLeading: false` on the
// conversation app bar is the same refusal, already made, one screen in.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;
  late int closes;

  setUp(() {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(client: client);
    closes = 0;
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  Widget wrap({VoidCallback? onClose}) => MaterialApp(
        home: ChatWidget(cubit: cubit, onClose: onClose),
      );

  testWidgets('Home carries a close control that calls the host back once',
      (WidgetTester tester) async {
    await tester.pumpWidget(wrap(onClose: () => closes += 1));

    expect(find.byType(HomeScreen), findsOneWidget);
    final Finder close = find.byTooltip(kCloseChatLabel);
    expect(close, findsOneWidget);

    await tester.tap(close);
    await tester.pump();

    expect(closes, 1);
    // Nothing else moved: closing is the HOST's business, and this widget
    // does not pre-empt it by navigating somewhere of its own first.
    expect(cubit.state.screen, ScreenName.home);
  });

  testWidgets('Messages carries the same control, under the same name',
      (WidgetTester tester) async {
    await tester.pumpWidget(wrap(onClose: () => closes += 1));
    await tester.tap(find.text('Messages'));
    await tester.pump();

    expect(find.byType(MessagesScreen), findsOneWidget);
    // ONE name across both screens, deliberately: from the customer's side
    // this is one affordance that happens to be on whichever tab they are
    // on, and a reader announcing two different names would describe it as
    // two different controls.
    final Finder close = find.byTooltip(kCloseChatLabel);
    expect(close, findsOneWidget);

    await tester.tap(close);
    await tester.pump();

    expect(closes, 1);
    expect(cubit.state.screen, ScreenName.messages);
  });

  testWidgets('a host that passes nothing gets no control, on either screen',
      (WidgetTester tester) async {
    await tester.pumpWidget(wrap());

    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.byTooltip(kCloseChatLabel), findsNothing);
    expect(find.byIcon(Icons.close), findsNothing);

    await tester.tap(find.text('Messages'));
    await tester.pump();

    expect(find.byType(MessagesScreen), findsOneWidget);
    expect(find.byTooltip(kCloseChatLabel), findsNothing);
    expect(find.byIcon(Icons.close), findsNothing);
  });

  testWidgets('the control is a real button with an accessible name',
      (WidgetTester tester) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await tester.pumpWidget(wrap(onClose: () => closes += 1));

    // Button-ness, the name, and a focus action, on ONE node: a bare
    // tappable box with no role is a control a screen-reader user is told
    // nothing about, and one that cannot take focus is unreachable without a
    // pointer.
    //
    // The name arrives as the semantics node's `tooltip` and NOT as its
    // `label` — that is where `IconButton` puts it, and it is the convention
    // `HeaderMenu` ('Conversation options'), `SessionSwitcher` and the
    // composer's Send button already follow. Asserted in the field it
    // actually lands in rather than wrapped in a second `Semantics(label:)`,
    // which would give this one control two names and have a reader say both.
    expect(
      tester.getSemantics(find.byTooltip(kCloseChatLabel)),
      matchesSemantics(
        tooltip: kCloseChatLabel,
        isButton: true,
        isEnabled: true,
        isFocusable: true,
        hasEnabledState: true,
        hasTapAction: true,
        hasFocusAction: true,
      ),
    );

    semantics.dispose();
  });

  testWidgets('pressing it pops NOTHING — the host owns the route',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) =>
                      ChatWidget(cubit: cubit, onClose: () => closes += 1),
                ),
              ),
              child: const Text('open support'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open support'));
    await tester.pumpAndSettle();
    expect(find.byType(ChatWidget), findsOneWidget);

    await tester.tap(find.byTooltip(kCloseChatLabel));
    await tester.pumpAndSettle();

    // The host was told, and the host has not acted yet — so the panel is
    // exactly where it was. A widget that popped its own route would have
    // taken this decision away from the app that pushed it, and would take
    // the WRONG route away from an app that never pushed one.
    expect(closes, 1);
    expect(find.byType(ChatWidget), findsOneWidget);
    expect(find.text('open support'), findsNothing);
  });
}
