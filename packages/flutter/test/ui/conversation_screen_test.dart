import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';

/// Lets a queued stream event actually reach its listener before the next
/// pump captures a frame.
///
/// `StreamController.add` (the default, non-sync controller
/// [FakeWidgetChatClient] uses) schedules delivery on a MICROTASK rather than
/// delivering synchronously, so the event has to be drained before an
/// assertion can see its effect.
///
/// ── Why this is `tester.pump()` and not `Future.delayed(Duration.zero)` ──
///
/// The sibling `chat_widget_cubit_test.dart` uses `Future.delayed` and is
/// right to: it is a plain `test()`, running on the real clock. Copying it
/// into `testWidgets` DEADLOCKS. Widget tests run inside a `FakeAsync` zone
/// whose clock only advances when the harness is told to advance it, so a
/// timer awaited directly — even a zero-duration one — is a timer nothing
/// will ever fire, and the test hangs until the runner kills it.
///
/// `tester.pump()` is the right tool and needs no delay at all: it drains the
/// microtask queue before it builds the frame, which is precisely the race
/// this helper exists to close.
Future<void> flush(WidgetTester tester) async {
  // `runAsync` steps OUT of the fake clock and onto the real one for the
  // duration of the callback, which is what lets the controller's queued
  // microtask actually be delivered. The `pump()` after it is what turns the
  // resulting Cubit state into a frame — one without the other leaves either
  // an undelivered event or an unrendered state.
  await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  await tester.pump();
}

Widget _wrap(ChatWidgetCubit cubit) {
  return BlocProvider<ChatWidgetCubit>.value(
    value: cubit,
    child: const MaterialApp(home: Scaffold(body: ConversationScreen())),
  );
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

  testWidgets('shows NewConversationView while composingNew is true', (tester) async {
    cubit.startNewConversation();
    await tester.pumpWidget(_wrap(cubit));
    expect(find.byType(NewConversationView), findsOneWidget);
    expect(find.text('Start'), findsOneWidget);
  });

  testWidgets('shows the empty-transcript prompt for an existing, message-less conversation', (tester) async {
    cubit.openConversation('past-session-1');
    await tester.pumpWidget(_wrap(cubit));
    expect(find.text('Send a message to get started.'), findsOneWidget);
    expect(find.byType(NewConversationView), findsNothing);
  });

  testWidgets('renders a bubble per message', (tester) async {
    cubit.openConversation('past-session-1');
    await tester.pumpWidget(_wrap(cubit));

    client.emitMessage(testMessage(id: 'm1', content: 'Hi, how can I help?'));
    client.emitMessage(testMessage(id: 'm2', content: 'My order never arrived', senderType: SenderType.customer));
    await flush(tester);
    await tester.pump();

    expect(find.text('Hi, how can I help?'), findsOneWidget);
    expect(find.text('My order never arrived'), findsOneWidget);
  });

  testWidgets('an outgoing (customer) message shows a delivery tick; an incoming one does not', (tester) async {
    cubit.openConversation('past-session-1');
    await tester.pumpWidget(_wrap(cubit));

    client.emitMessage(
      testMessage(id: 'm1', content: 'from the agent', senderType: SenderType.agent, delivery: MessageDelivery.confirmed),
    );
    client.emitMessage(
      testMessage(id: 'm2', content: 'from me', senderType: SenderType.customer, delivery: MessageDelivery.pending),
    );
    await flush(tester);
    await tester.pump();

    // Exactly one tick icon (schedule, for the pending customer message).
    expect(find.byIcon(Icons.schedule), findsOneWidget);
    expect(find.byIcon(Icons.done), findsNothing);
  });

  testWidgets('a failed send shows "Not sent"', (tester) async {
    cubit.openConversation('past-session-1');
    await tester.pumpWidget(_wrap(cubit));

    client.emitMessage(
      testMessage(id: 'm1', senderType: SenderType.customer, delivery: MessageDelivery.failed),
    );
    await flush(tester);
    await tester.pump();

    expect(find.text('Not sent'), findsOneWidget);
  });

  testWidgets('quick replies show under the newest incoming message and send on tap', (tester) async {
    cubit.openConversation('past-session-1');
    await tester.pumpWidget(_wrap(cubit));

    client.emitMessage(
      testMessage(
        id: 'm1',
        content: 'Want to track your order?',
        metadata: {'options': <Object?>['Track my order', 'Talk to a human']},
      ),
    );
    await flush(tester);
    await tester.pump();

    expect(find.text('Track my order'), findsOneWidget);
    await tester.tap(find.text('Track my order'));
    await tester.pump();

    expect(client.sentContent, <String>['Track my order']);
  });

  testWidgets('quick replies disappear once the customer sends their own message', (tester) async {
    cubit.openConversation('past-session-1');
    await tester.pumpWidget(_wrap(cubit));

    client.emitMessage(
      testMessage(id: 'm1', metadata: {'options': <Object?>['Yes']}),
    );
    await flush(tester);
    await tester.pump();
    expect(find.text('Yes'), findsOneWidget);

    client.emitMessage(testMessage(id: 'm2', senderType: SenderType.customer, content: 'ok'));
    await flush(tester);
    await tester.pump();

    expect(find.text('Yes'), findsNothing);
  });

  testWidgets('the typing indicator shows only while isTyping', (tester) async {
    cubit.openConversation('past-session-1');
    await tester.pumpWidget(_wrap(cubit));

    expect(find.text('…'), findsNothing);
    client.emitTyping(true);
    await flush(tester);
    await tester.pump();
    expect(find.text('…'), findsOneWidget);

    client.emitTyping(false);
    await flush(tester);
    await tester.pump();
    expect(find.text('…'), findsNothing);
  });

  testWidgets('the composer is present and sends through the Cubit', (tester) async {
    cubit.openConversation('past-session-1');
    await tester.pumpWidget(_wrap(cubit));

    expect(find.byType(Composer), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'a follow-up');
    await tester.pump();
    await tester.tap(find.widgetWithIcon(IconButton, Icons.send));
    await tester.pump();

    expect(client.sentContent, <String>['a follow-up']);
  });
}
