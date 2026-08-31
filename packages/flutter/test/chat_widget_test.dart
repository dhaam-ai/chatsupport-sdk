import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'state/fake_widget_chat_client.dart';

Widget _wrap(ChatWidgetCubit cubit) => MaterialApp(home: ChatWidget(cubit: cubit));

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

  testWidgets('connects once on mount', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    expect(client.connectCalls, 1);
  });

  testWidgets('starts on Home, with no back bar', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.byType(AppBar), findsNothing);
  });

  testWidgets('the bottom nav is present from the start', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    expect(find.byType(ChatBottomNav), findsOneWidget);
  });

  testWidgets('tapping the Messages tab switches screens, still no back bar', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await tester.tap(find.text('Messages'));
    await tester.pump();

    expect(find.byType(MessagesScreen), findsOneWidget);
    expect(find.byType(AppBar), findsNothing);
  });

  testWidgets('starting a new conversation shows a back bar titled "New conversation"', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await tester.tap(find.text('Send us a message'));
    await tester.pump();

    expect(find.byType(ConversationScreen), findsOneWidget);
    expect(find.byType(AppBar), findsOneWidget);
    expect(find.text('New conversation'), findsOneWidget);
    expect(find.byType(BackButton), findsOneWidget);
  });

  testWidgets('tapping the back button returns to Home and drops the back bar', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await tester.tap(find.text('Send us a message'));
    await tester.pump();
    expect(cubit.state.canGoBack, isTrue);

    await tester.tap(find.byType(BackButton));
    await tester.pump();

    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.byType(AppBar), findsNothing);
  });

  testWidgets('PopScope.canPop mirrors !state.canGoBack, and an unconsumed system pop calls cubit.back()', (tester) async {
    // PopScope<T> is generic (confirmed against the pinned SDK's own source,
    // packages/flutter/lib/src/widgets/pop_scope.dart), and this widget's
    // onPopInvokedWithResult callback makes Dart infer PopScope<Object> —
    // found by printing tester.allWidgets' runtimeTypes, since the obvious
    // guess (PopScope<Object?>, matching the callback's nullable `result`
    // parameter) does not match what Dart actually infers here. A
    // predicate on the runtimeType's string name sidesteps needing the
    // exact type argument at all, which is what every other find.byType
    // call in this suite gets for free with a non-generic widget.
    final popScopeFinder = find.byWidgetPredicate((Widget w) => w.runtimeType.toString().startsWith('PopScope'));

    await tester.pumpWidget(_wrap(cubit));
    expect(tester.widget<PopScope>(popScopeFinder).canPop, isTrue);

    cubit.startNewConversation();
    await tester.pump();
    expect(tester.widget<PopScope>(popScopeFinder).canPop, isFalse);

    // Simulates exactly what the framework calls when a system back gesture
    // was NOT consumed by a nested Navigator (didPop: false) — see
    // https://api.flutter.dev/flutter/widgets/PopScope-class.html.
    final PopScope popScope = tester.widget(popScopeFinder);
    popScope.onPopInvokedWithResult!(false, null);
    await tester.pump();

    expect(cubit.state.screen, ScreenName.home);
  });

  testWidgets('the panel theme follows the published accent, not the host MaterialApp theme', (tester) async {
    cubit = ChatWidgetCubit(client: client, initialConfig: defaultRemoteConfig);
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(colorScheme: const ColorScheme.light(primary: Colors.purple)),
        home: ChatWidget(cubit: cubit),
      ),
    );

    final ThemeData panelTheme = Theme.of(tester.element(find.byType(HomeScreen)));
    // Falls back to kDefaultAccent (#1f2937), not the host app's purple.
    expect(panelTheme.colorScheme.primary, isNot(Colors.purple));
  });
}
