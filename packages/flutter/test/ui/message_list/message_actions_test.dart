import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: Center(
        child: Row(
          children: <Widget>[
            const SizedBox(width: 120, height: 120, child: Text('outside')),
            child,
          ],
        ),
      ),
    ),
  );
}

void main() {
  group('MessageActions', () {
    testWidgets('offers Reply directly without a message overflow menu',
        (WidgetTester tester) async {
      int replies = 0;
      await tester.pumpWidget(
        _wrap(
          MessageActions(onReply: () => replies += 1),
        ),
      );

      expect(find.byTooltip('Reply'), findsOneWidget);
      expect(find.byTooltip('Message actions'), findsNothing);
      expect(find.byIcon(Icons.more_vert), findsNothing);

      await tester.tap(find.byTooltip('Reply'));
      await tester.pump();
      expect(replies, 1);
    });

    testWidgets('a copy-only row renders no message controls',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        _wrap(
          const MessageActions(onReply: null),
        ),
      );

      expect(find.text('Reply'), findsNothing);
      expect(find.text('Copy'), findsNothing);
      expect(find.text('Edit'), findsNothing);
      expect(find.text('Delete'), findsNothing);
      expect(find.byTooltip('Message actions'), findsNothing);
      expect(find.byIcon(Icons.more_vert), findsNothing);
      expect(find.byWidgetPredicate((Widget widget) => widget is TextButton),
          findsNothing);
    });
  });
}
