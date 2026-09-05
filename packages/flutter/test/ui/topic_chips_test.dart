import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _topics = <ConversationTopic>[
  ConversationTopic(id: 't1', label: 'Delivery issue'),
  ConversationTopic(id: 't2', label: 'Refund'),
];

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('renders nothing when there are no topics', (tester) async {
    await tester.pumpWidget(
        _wrap(TopicChips(topics: const [], selected: null, onSelect: (_) {})));
    expect(find.byType(ChoiceChip), findsNothing);
  });

  testWidgets('renders one chip per topic', (tester) async {
    await tester.pumpWidget(
        _wrap(TopicChips(topics: _topics, selected: null, onSelect: (_) {})));
    expect(find.text('Delivery issue'), findsOneWidget);
    expect(find.text('Refund'), findsOneWidget);
  });

  testWidgets('marks only the selected topic\'s chip selected', (tester) async {
    await tester.pumpWidget(_wrap(
        TopicChips(topics: _topics, selected: _topics[0], onSelect: (_) {})));
    final chips =
        tester.widgetList<ChoiceChip>(find.byType(ChoiceChip)).toList();
    expect(chips[0].selected, isTrue);
    expect(chips[1].selected, isFalse);
  });

  testWidgets('no topic selected -> every chip reads unselected',
      (tester) async {
    await tester.pumpWidget(
        _wrap(TopicChips(topics: _topics, selected: null, onSelect: (_) {})));
    final chips =
        tester.widgetList<ChoiceChip>(find.byType(ChoiceChip)).toList();
    expect(chips.every((chip) => chip.selected == false), isTrue);
  });

  testWidgets('tapping a chip calls onSelect with that topic', (tester) async {
    ConversationTopic? tapped;
    await tester.pumpWidget(_wrap(TopicChips(
        topics: _topics, selected: null, onSelect: (t) => tapped = t)));

    await tester.tap(find.text('Refund'));

    expect(tapped, _topics[1]);
  });
}
