import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(bottomNavigationBar: child));

Color? _labelColor(WidgetTester tester, String label) => tester.widget<Text>(find.text(label)).style?.color;

void main() {
  testWidgets('renders both tab labels', (tester) async {
    await tester.pumpWidget(_wrap(ChatBottomNav(active: ScreenName.home, unreadCount: 0, onSelect: (_) {})));
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Messages'), findsOneWidget);
  });

  testWidgets('tapping Home calls onSelect(ScreenName.home)', (tester) async {
    ScreenName? selected;
    await tester.pumpWidget(
      _wrap(ChatBottomNav(active: ScreenName.messages, unreadCount: 0, onSelect: (tab) => selected = tab)),
    );
    await tester.tap(find.text('Home'));
    expect(selected, ScreenName.home);
  });

  testWidgets('tapping Messages calls onSelect(ScreenName.messages)', (tester) async {
    ScreenName? selected;
    await tester.pumpWidget(
      _wrap(ChatBottomNav(active: ScreenName.home, unreadCount: 0, onSelect: (tab) => selected = tab)),
    );
    await tester.tap(find.text('Messages'));
    expect(selected, ScreenName.messages);
  });

  testWidgets('the active tab reads in the primary colour, the inactive one muted', (tester) async {
    await tester.pumpWidget(_wrap(ChatBottomNav(active: ScreenName.home, unreadCount: 0, onSelect: (_) {})));
    final ColorScheme scheme = Theme.of(tester.element(find.text('Home'))).colorScheme;

    expect(_labelColor(tester, 'Home'), scheme.primary);
    expect(_labelColor(tester, 'Messages'), scheme.onSurfaceVariant);
  });

  testWidgets('neither tab reads active while a conversation is open — it is not a tab', (tester) async {
    await tester.pumpWidget(
      _wrap(ChatBottomNav(active: ScreenName.conversation, unreadCount: 0, onSelect: (_) {})),
    );
    final ColorScheme scheme = Theme.of(tester.element(find.text('Home'))).colorScheme;

    expect(_labelColor(tester, 'Home'), scheme.onSurfaceVariant);
    expect(_labelColor(tester, 'Messages'), scheme.onSurfaceVariant);
  });

  testWidgets('no badge renders with nothing unread', (tester) async {
    await tester.pumpWidget(_wrap(ChatBottomNav(active: ScreenName.home, unreadCount: 0, onSelect: (_) {})));
    expect(find.byType(Badge), findsNothing);
  });

  testWidgets('the unread badge shows a plain count under the cap', (tester) async {
    await tester.pumpWidget(_wrap(ChatBottomNav(active: ScreenName.home, unreadCount: 3, onSelect: (_) {})));
    expect(find.text('3'), findsOneWidget);
  });

  testWidgets('the unread badge caps at 99+, matching nav.ts\'s own cap', (tester) async {
    await tester.pumpWidget(_wrap(ChatBottomNav(active: ScreenName.home, unreadCount: 250, onSelect: (_) {})));
    expect(find.text('99+'), findsOneWidget);
  });
}
