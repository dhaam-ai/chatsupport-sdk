import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';

Widget _wrap(ChatWidgetCubit cubit,
    {VoidCallback? onBack, VoidCallback? onClose}) {
  return BlocProvider<ChatWidgetCubit>.value(
    value: cubit,
    child: MaterialApp(
      home: Scaffold(body: MessagesScreen(onBack: onBack, onClose: onClose)),
    ),
  );
}

ChatSessionSummary _summary({
  required String id,
  String? subject,
  String? topic,
  String? preview,
  HandledBy? handledBy,
  int unreadCount = 0,
  ChatStatus status = ChatStatus.open,
}) {
  return ChatSessionSummary(
    id: id,
    status: status,
    mode: ChatMode.human,
    createdAt: DateTime.utc(2026, 1, 1),
    lastMessageAt: DateTime.utc(2026, 1, 2),
    lastMessagePreview: preview,
    handledBy: handledBy,
    subject: subject,
    topic: topic,
    unreadCount: unreadCount,
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

  testWidgets('the empty state shows before any summaries arrive',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    expect(find.text('No previous conversations yet.'), findsOneWidget);
    expect(find.text('Start a new conversation when you need help.'),
        findsOneWidget);
  });

  testWidgets('tapping New conversation starts one', (tester) async {
    await tester.pumpWidget(_wrap(cubit));
    await tester.tap(find.text('New conversation'));
    await tester.pump();
    expect(cubit.state.screen, ScreenName.conversation);
    expect(cubit.state.composingNew, isTrue);
    expect(cubit.state.activeSurface, isA<ComposingNewSurface>());
  });

  testWidgets('hides the footer CTA while the empty state owns it',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));

    expect(find.text('New conversation'), findsOneWidget);

    cubit.updateSessionSummaries([_summary(id: 'a', subject: 'Refund')]);
    await tester.pump();

    expect(find.text('New conversation'), findsOneWidget);
    expect(find.text('No previous conversations yet.'), findsNothing);
  });

  testWidgets('renders an inline back button when supplied', (tester) async {
    int backCalls = 0;
    await tester.pumpWidget(_wrap(cubit, onBack: () => backCalls += 1));

    expect(find.text('Messages'), findsOneWidget);
    expect(find.byTooltip('Back'), findsOneWidget);
    await tester.tap(find.byTooltip('Back'));
    await tester.pump();

    expect(backCalls, 1);
  });

  testWidgets('calls close from the header close affordance', (tester) async {
    int closeCalls = 0;
    await tester.pumpWidget(_wrap(cubit, onClose: () => closeCalls += 1));

    expect(find.byTooltip('Close chat'), findsOneWidget);
    await tester.tap(find.byTooltip('Close chat'));
    await tester.pump();

    expect(closeCalls, 1);
  });

  testWidgets('search field has an outline border and primary focused border',
      (tester) async {
    await tester.pumpWidget(_wrap(cubit));

    final ThemeData theme = Theme.of(tester.element(find.byType(TextField)));
    InputDecoration decoration =
        tester.widget<TextField>(find.byType(TextField)).decoration!;

    expect(
      (decoration.enabledBorder! as OutlineInputBorder).borderSide.color,
      theme.colorScheme.outlineVariant,
    );
    expect(
      (decoration.enabledBorder! as OutlineInputBorder).borderRadius,
      BorderRadius.circular(8),
    );
    expect(
      (decoration.focusedBorder! as OutlineInputBorder).borderSide.color,
      theme.colorScheme.primary,
    );
    expect(decoration.prefixIconConstraints,
        const BoxConstraints.tightFor(width: 34, height: 36));

    await tester.tap(find.byType(TextField));
    await tester.pump();

    decoration = tester.widget<TextField>(find.byType(TextField)).decoration!;
    expect(
      (decoration.border! as OutlineInputBorder).borderSide.color,
      theme.colorScheme.primary,
    );
  });

  group(
      'row heading resolution — subject, then topic, then handledBy, then a generic fallback',
      () {
    testWidgets('subject wins when present', (tester) async {
      cubit.updateSessionSummaries([
        _summary(
            id: 'a',
            subject: 'Order never arrived',
            topic: 'Delivery issue',
            handledBy: const HandledBy(
                kind: HandledByKind.agent, id: 'x', displayName: 'Priya')),
      ]);
      await tester.pumpWidget(_wrap(cubit));
      expect(find.text('Order never arrived'), findsOneWidget);
    });

    testWidgets('topic is used when there is no subject', (tester) async {
      cubit
          .updateSessionSummaries([_summary(id: 'a', topic: 'Delivery issue')]);
      await tester.pumpWidget(_wrap(cubit));
      expect(find.text('Delivery issue'), findsOneWidget);
    });

    testWidgets('falls back to who handled it when neither is set',
        (tester) async {
      cubit.updateSessionSummaries([
        _summary(
            id: 'a',
            handledBy: const HandledBy(
                kind: HandledByKind.bot, id: 'b', displayName: 'Assistant')),
      ]);
      await tester.pumpWidget(_wrap(cubit));
      expect(find.text('Assistant'), findsOneWidget);
    });

    testWidgets('falls back to a generic label rather than inventing a title',
        (tester) async {
      cubit.updateSessionSummaries([_summary(id: 'a')]);
      await tester.pumpWidget(_wrap(cubit));
      expect(find.text('Conversation'), findsOneWidget);
    });
  });

  testWidgets(
      'renders status, preview, handledBy text, and a capped unread badge',
      (tester) async {
    cubit.updateSessionSummaries([
      _summary(
        id: 'a',
        subject: 'Refund request',
        preview: 'I would like a refund please',
        handledBy: const HandledBy(
            kind: HandledByKind.agent, id: 'x', displayName: 'Priya'),
        unreadCount: 250,
        status: ChatStatus.waitingForAgent,
      ),
    ]);
    await tester.pumpWidget(_wrap(cubit));

    expect(find.text('Waiting'), findsOneWidget);
    expect(find.text('I would like a refund please'), findsOneWidget);
    expect(find.text('with Priya'), findsOneWidget);
    expect(find.text('99+'), findsOneWidget);
  });

  testWidgets('tapping a row opens that conversation', (tester) async {
    cubit.updateSessionSummaries(
        [_summary(id: 'session-42', subject: 'Refund request')]);
    await tester.pumpWidget(_wrap(cubit));

    await tester.tap(find.text('Refund request'));
    expect(client.joinedSessionIds, <String>['session-42']);
    expect(cubit.state.screen, ScreenName.conversation);
    expect(cubit.state.composingNew, isFalse);
  });

  group('search', () {
    setUp(() {
      cubit.updateSessionSummaries([
        _summary(
            id: 'a',
            subject: 'Refund request',
            preview: 'Please refund my order'),
        _summary(
            id: 'b',
            topic: 'Delivery issue',
            preview: 'Package never showed up'),
      ]);
    });

    testWidgets('filters by subject/topic/preview, case-insensitively',
        (tester) async {
      await tester.pumpWidget(_wrap(cubit));

      await tester.enterText(find.byType(TextField), 'delivery');
      await tester.pumpAndSettle();

      expect(find.text('Delivery issue'), findsOneWidget);
      expect(find.text('Refund request'), findsNothing);
    });

    testWidgets('matches on the status label as well as the preview text',
        (tester) async {
      // The rule `messages-screen.ts` states for its own filter: nothing is
      // searchable that is not on screen, so a match is always explainable
      // by looking at the row that produced it. The status is the most
      // prominent thing on a row after the heading — a customer who reads
      // "Resolved" and types it getting nothing is the filter contradicting
      // the list.
      cubit.updateSessionSummaries([
        _summary(id: 'a', subject: 'x', status: ChatStatus.resolved),
        _summary(id: 'b', subject: 'y', status: ChatStatus.open),
      ]);
      await tester.pumpWidget(_wrap(cubit));

      await tester.enterText(find.byType(TextField), 'resolved');
      await tester.pumpAndSettle();

      expect(find.text('x'), findsOneWidget);
      expect(find.text('y'), findsNothing);
    });

    testWidgets('matches the words on screen, never the enum name',
        (tester) async {
      // "With an agent" is what ASSIGNED renders as; "assigned" is a queue
      // fact the customer never sees, so it is not what they can type.
      cubit.updateSessionSummaries([
        _summary(id: 'a', subject: 'x', status: ChatStatus.assigned),
      ]);
      await tester.pumpWidget(_wrap(cubit));

      await tester.enterText(find.byType(TextField), 'with an agent');
      await tester.pumpAndSettle();
      expect(find.text('x'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'assigned');
      await tester.pumpAndSettle();
      expect(find.text('No conversations match your search.'), findsOneWidget);
    });

    testWidgets('an unmatched query shows the search-specific empty state',
        (tester) async {
      await tester.pumpWidget(_wrap(cubit));

      await tester.enterText(find.byType(TextField), 'nothing matches this');
      await tester.pumpAndSettle();

      expect(find.text('No conversations match your search.'), findsOneWidget);
      expect(
          find.text(
              'Try a different word, or start a new conversation about it.'),
          findsOneWidget);
      expect(find.text('New conversation'), findsOneWidget);
    });

    testWidgets('clear button appears for text and clears the query',
        (tester) async {
      await tester.pumpWidget(_wrap(cubit));

      expect(find.byTooltip('Clear search'), findsNothing);

      await tester.enterText(find.byType(TextField), 'delivery');
      await tester.pumpAndSettle();

      expect(find.byTooltip('Clear search'), findsOneWidget);
      expect(find.text('Delivery issue'), findsOneWidget);
      expect(find.text('Refund request'), findsNothing);

      await tester.tap(find.byTooltip('Clear search'));
      await tester.pumpAndSettle();

      expect(find.byTooltip('Clear search'), findsNothing);
      expect(find.text('Delivery issue'), findsOneWidget);
      expect(find.text('Refund request'), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).controller?.text,
          isEmpty);
    });

    testWidgets('clearing the query restores every row', (tester) async {
      await tester.pumpWidget(_wrap(cubit));
      await tester.enterText(find.byType(TextField), 'delivery');
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '');
      await tester.pumpAndSettle();

      expect(find.text('Delivery issue'), findsOneWidget);
      expect(find.text('Refund request'), findsOneWidget);
    });
  });
}
