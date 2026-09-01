import 'package:dhaam_chat/dhaam_chat.dart' show ConnectionState;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
// Flutter's own async.dart (re-exported through material.dart) declares a
// SECOND, unrelated ConnectionState (AsyncSnapshot's none/waiting/active/
// done) — hidden here for the same reason chat_widget.dart's own import
// hides it: this suite drives dhaam_chat's §8.1 one and never touches
// Flutter's.
import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter_test/flutter_test.dart';

import 'state/fake_widget_chat_client.dart';
import 'support/remote_config_fixtures.dart';

Widget _wrap(ChatWidgetCubit cubit) => MaterialApp(home: ChatWidget(cubit: cubit));

/// Lets a queued connection-state event actually reach [ChatWidgetCubit]
/// before the next pump captures a frame. Same helper, same reasoning, as
/// `test/ui/conversation_screen_test.dart`'s own `flush` — copied rather
/// than shared, since that one lives under `test/ui/` and importing across
/// test-directory siblings is not a pattern this suite otherwise uses.
///
/// `StreamController.add` (the default, non-`sync` controller
/// [FakeWidgetChatClient] uses) schedules delivery on a MICROTASK, so the
/// event has to be drained before an assertion can see its effect.
///
/// This is `tester.pump()`, NOT `Future.delayed(Duration.zero)`: widget
/// tests run inside a `FakeAsync` zone whose clock only advances when the
/// harness advances it, so a timer awaited directly — even a zero-duration
/// one — never fires and the test hangs until the runner kills it.
/// `tester.runAsync` steps OUT to the real clock for the queued microtask to
/// actually be delivered; the `pump()` after it turns the resulting Cubit
/// state into a frame.
Future<void> flush(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  await tester.pump();
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

  group('the unavailable panel', () {
    // The gate is the client having GIVEN UP, not it having failed. Showing
    // this over a reconnect that is about to succeed would tell a customer the
    // service is down while it is coming back.
    testWidgets('stays hidden while the client is still working', (tester) async {
      await tester.pumpWidget(_wrap(cubit));
      for (final ConnectionState state in <ConnectionState>[
        ConnectionState.idle,
        ConnectionState.connecting,
        ConnectionState.connected,
        ConnectionState.reconnecting,
      ]) {
        client.emitConnectionState(state);
        await flush(tester);
        expect(find.byType(UnavailableView), findsNothing, reason: '$state is not terminal');
      }
    });

    testWidgets('appears once the client has given up', (tester) async {
      await tester.pumpWidget(_wrap(cubit));
      for (final ConnectionState state in kTerminalConnectionStates) {
        client.emitConnectionState(state);
        await flush(tester);
        expect(find.byType(UnavailableView), findsOneWidget, reason: '$state is terminal');
        expect(find.text('Chat is temporarily unavailable'), findsOneWidget);
        // Nothing else is left behind it — a live composer under this notice
        // would invite a message that has nowhere to go.
        expect(find.byType(HomeScreen), findsNothing);
      }
    });

    testWidgets('Try again reconnects through the Cubit', (tester) async {
      await tester.pumpWidget(_wrap(cubit));
      client.emitConnectionState(ConnectionState.closed);
      await flush(tester);

      final int before = client.connectCalls;
      await tester.tap(find.text('Try again'));
      await flush(tester);
      expect(client.connectCalls, before + 1);
    });

    // The rule shared with the JS widget: an address nobody monitors is worse
    // than admitting there is no second route, because the customer waits on a
    // reply that never comes.
    testWidgets('offers no email when the merchant configured none', (tester) async {
      await tester.pumpWidget(_wrap(cubit));
      client.emitConnectionState(ConnectionState.closed);
      await flush(tester);
      expect(find.textContaining('Email '), findsNothing);
    });

    testWidgets('offers the merchant address when there is one', (tester) async {
      cubit.applyRemoteConfig(testRemoteConfig(supportEmail: 'support@dhaam.com'));
      await tester.pumpWidget(_wrap(cubit));
      client.emitConnectionState(ConnectionState.closed);
      await flush(tester);
      expect(find.text('Email support@dhaam.com'), findsOneWidget);
    });

    // Merchant-supplied and lands in a mailto:, where a newline can append
    // HEADERS to the message the customer is about to send.
    testWidgets('offers nothing rather than an address it could not make safe', (tester) async {
      cubit.applyRemoteConfig(testRemoteConfig(supportEmail: 'a@b.com\nbcc:x@evil.test'));
      await tester.pumpWidget(_wrap(cubit));
      client.emitConnectionState(ConnectionState.closed);
      await flush(tester);
      expect(find.textContaining('Email '), findsNothing);
    });
  });
}
