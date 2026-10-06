// Widget coverage for the sliver-backed Home hero.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/remote_config_fixtures.dart';

RemoteConfig _hero() => testRemoteConfig(
      header: const HeaderAppearance(
        greeting: 'Hi there',
        subGreeting: 'How can we help?',
      ),
    );

RemoteConfig _heroWithCompactBar() => testRemoteConfig(
      header: const HeaderAppearance(
        greeting: 'Hi there',
        subGreeting: 'How can we help?',
        showLogo: true,
      ),
      logoUrl: 'https://cdn.example.com/logo.png',
    );

void main() {
  group('CollapsingHeroHeader — the widget', () {
    Future<ScrollController> pumpHome(
      WidgetTester tester, {
      required RemoteConfig config,
      required double contentHeight,
      double viewportHeight = 300,
      VoidCallback? onClose,
    }) async {
      final ScrollController controller = ScrollController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              height: viewportHeight,
              child: CollapsingHeroHeader(
                config: config,
                controller: controller,
                onClose: onClose,
                slivers: <Widget>[
                  SliverToBoxAdapter(child: SizedBox(height: contentHeight)),
                ],
              ),
            ),
          ),
        ),
      );
      return controller;
    }

    Finder expandedCopy() => find.text('Hi there');
    Finder collapsedBar() =>
        find.byKey(const ValueKey<String>('hero.collapsedBar'));

    testWidgets('renders the hero at rest', (WidgetTester tester) async {
      await pumpHome(tester, config: _hero(), contentHeight: 1000);

      expect(expandedCopy(), findsOneWidget);
      expect(collapsedBar(), findsNothing);
    });

    testWidgets('collapses into the compact bar as the visitor scrolls',
        (WidgetTester tester) async {
      final ScrollController controller = await pumpHome(tester,
          config: _heroWithCompactBar(), contentHeight: 1000);

      controller.jumpTo(260);
      await tester.pump();

      expect(collapsedBar(), findsOneWidget);
    });

    testWidgets('returns whole when the visitor scrolls back to the top',
        (WidgetTester tester) async {
      final ScrollController controller = await pumpHome(tester,
          config: _heroWithCompactBar(), contentHeight: 1000);

      controller.jumpTo(260);
      await tester.pump();
      expect(collapsedBar(), findsOneWidget);

      controller.jumpTo(0);
      await tester.pump();

      expect(expandedCopy(), findsOneWidget);
      expect(collapsedBar(), findsNothing);
    });

    testWidgets('renders both layers during a partial collapse',
        (WidgetTester tester) async {
      final ScrollController controller = await pumpHome(tester,
          config: _heroWithCompactBar(), contentHeight: 1000);

      controller.jumpTo(90);
      await tester.pump();

      expect(expandedCopy(), findsOneWidget);
      expect(collapsedBar(), findsOneWidget);
    });

    testWidgets('renders expanded when the content does not scroll',
        (WidgetTester tester) async {
      await pumpHome(tester, config: _hero(), contentHeight: 1);

      expect(expandedCopy(), findsOneWidget);
      expect(collapsedBar(), findsNothing);
    });

    testWidgets('renders no hero sliver for an empty hero',
        (WidgetTester tester) async {
      await pumpHome(tester, config: testRemoteConfig(), contentHeight: 1000);

      expect(find.byKey(const ValueKey<String>('hero.sliverHeader')),
          findsNothing);
      expect(find.byType(HeroHeader), findsNothing);
    });
  });
}
