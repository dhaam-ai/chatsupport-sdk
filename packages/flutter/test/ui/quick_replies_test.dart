import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';

void main() {
  group('readQuickReplies', () {
    test('null metadata -> no chips', () {
      expect(readQuickReplies(null), isEmpty);
    });

    test('metadata with no options key -> no chips', () {
      expect(readQuickReplies(<String, Object?>{'foo': 'bar'}), isEmpty);
    });

    test('options not a list -> no chips', () {
      expect(readQuickReplies(<String, Object?>{'options': 'not a list'}), isEmpty);
    });

    test('reads plain string options, trimmed', () {
      expect(
        readQuickReplies(<String, Object?>{
          'options': <Object?>['  Track my order  ', 'Talk to a human'],
        }),
        <String>['Track my order', 'Talk to a human'],
      );
    });

    test('drops non-string entries, blanks, and de-duplicates', () {
      expect(
        readQuickReplies(<String, Object?>{
          'options': <Object?>['Yes', 'Yes', '', '   ', 42, null, 'No'],
        }),
        <String>['Yes', 'No'],
      );
    });

    test('drops a label over the max length — a sentence, not an option', () {
      final tooLong = 'x' * (kMaxQuickReplyLabel + 1);
      expect(readQuickReplies(<String, Object?>{'options': <Object?>[tooLong, 'ok']}), <String>['ok']);
    });

    test('caps at kMaxQuickReplies even when the model returns more', () {
      final many = List<String>.generate(20, (i) => 'option $i');
      expect(readQuickReplies(<String, Object?>{'options': many}), hasLength(kMaxQuickReplies));
    });
  });

  group('quickRepliesFor', () {
    test('empty transcript -> no chips', () {
      expect(quickRepliesFor(const <ChatMessage>[]), isEmpty);
    });

    test('reads options off the NEWEST message', () {
      final messages = [
        testMessage(id: 'm1', metadata: {'options': <Object?>['stale']}),
        testMessage(id: 'm2', metadata: {'options': <Object?>['fresh']}),
      ];
      expect(quickRepliesFor(messages), <String>['fresh']);
    });

    test('no chips when the newest message is the customer\'s own', () {
      final messages = [
        testMessage(id: 'm1', metadata: {'options': <Object?>['ignored']}),
        testMessage(id: 'm2', senderType: SenderType.customer, content: 'ok thanks'),
      ];
      expect(quickRepliesFor(messages), isEmpty);
    });

    test('a bot message with no metadata -> no chips, not an error', () {
      expect(quickRepliesFor([testMessage(id: 'm1')]), isEmpty);
    });
  });

  group('QuickReplies widget', () {
    Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

    testWidgets('renders nothing for an empty option list', (tester) async {
      await tester.pumpWidget(wrap(QuickReplies(options: const [], onSelect: (_) {})));
      expect(find.byType(ActionChip), findsNothing);
    });

    testWidgets('renders one chip per option', (tester) async {
      await tester.pumpWidget(wrap(QuickReplies(options: const ['Yes', 'No'], onSelect: (_) {})));
      expect(find.text('Yes'), findsOneWidget);
      expect(find.text('No'), findsOneWidget);
    });

    testWidgets('tapping a chip calls onSelect with its text', (tester) async {
      String? selected;
      await tester.pumpWidget(wrap(QuickReplies(options: const ['Yes', 'No'], onSelect: (v) => selected = v)));
      await tester.tap(find.text('No'));
      expect(selected, 'No');
    });
  });
}
