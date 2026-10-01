// Reproduces `hero-header.test.ts`'s collapse block.
//
// The reference drives it through a fake `IntersectionObserver` and stubs
// `offsetHeight` / `scrollHeight` / `clientHeight`, "exactly as a real layout
// would have produced it", because jsdom computes no layout. Here the rule is
// a pure function over those same three numbers, so the arithmetic is
// asserted directly and the widget that feeds it is driven with a real scroll
// against a real layout.

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

void main() {
  group('heroCollapseDecision — the arithmetic', () {
    // Guard 1: the slack margin. At (or near) the top the hero is whole.
    test('expands at the top', () {
      expect(
        heroCollapseDecision(
          scrollOffset: 0,
          maxScrollExtent: 900,
          heroHeight: 200,
        ),
        HeroCollapseDecision.expand,
      );
    });

    test('still expands inside the slack margin', () {
      expect(
        heroCollapseDecision(
          scrollOffset: kHeroCollapseSlackPx,
          maxScrollExtent: 900,
          heroHeight: 200,
        ),
        HeroCollapseDecision.expand,
      );
    });

    test('collapses once the visitor is past the slack, with room to spare',
        () {
      expect(
        heroCollapseDecision(
          scrollOffset: kHeroCollapseSlackPx + 1,
          maxScrollExtent: 900,
          heroHeight: 200,
        ),
        HeroCollapseDecision.collapse,
      );
    });

    // Guard 2, and the whole point. The reference's own case: content
    // overflows by 100px while the hero stands 200px tall. Collapsing would
    // free 200px, the offset would clamp back to the top, the hero would
    // expand, and the two states would re-trigger each other every frame.
    test('refuses to collapse when handing the height back would un-scroll it',
        () {
      expect(
        heroCollapseDecision(
          scrollOffset: 100,
          maxScrollExtent: 100,
          heroHeight: 200,
        ),
        HeroCollapseDecision.hold,
      );
    });

    // ...and the reference's other side of the same boundary: 300px of
    // overflow against a 200px hero leaves 100px, comfortably past the slack.
    test('collapses once the overflow clears the freed height plus the slack',
        () {
      expect(
        heroCollapseDecision(
          scrollOffset: 100,
          maxScrollExtent: 300,
          heroHeight: 200,
        ),
        HeroCollapseDecision.collapse,
      );
    });

    // Exactly at the slack is still a refusal: the survivor has to be MORE
    // than the slack, or the clamped offset lands back in the expand zone.
    test('refuses at exactly the slack, and allows one pixel past it', () {
      expect(
        heroCollapseDecision(
          scrollOffset: 100,
          maxScrollExtent: 200 + kHeroCollapseSlackPx,
          heroHeight: 200,
        ),
        HeroCollapseDecision.hold,
      );
      expect(
        heroCollapseDecision(
          scrollOffset: 100,
          maxScrollExtent: 200 + kHeroCollapseSlackPx + 1,
          heroHeight: 200,
        ),
        HeroCollapseDecision.collapse,
      );
    });

    // Refusing is NOT expanding. A boolean here would make the refusal a
    // second writer of the state, fighting whatever put the hero where it is.
    test('a refusal is its own answer, distinct from expand', () {
      expect(HeroCollapseDecision.hold, isNot(HeroCollapseDecision.expand));
    });

    // Both guards are needed, and this is what each one catches on its own.
    test('the slack margin alone would not save a barely-overflowing Home', () {
      // Past the margin, so guard 1 has let this through...
      const double offset = kHeroCollapseSlackPx + 1;
      // ...and only guard 2 stops it, because collapsing frees more than the
      // container has to give.
      expect(
        heroCollapseDecision(
          scrollOffset: offset,
          maxScrollExtent: 210,
          heroHeight: 200,
        ),
        HeroCollapseDecision.hold,
      );
    });

    test('the layout check alone would not stop a sub-slack scroll', () {
      // Plenty of room for guard 2 to allow a collapse...
      // ...but the visitor has barely moved, so guard 1 keeps the hero whole.
      expect(
        heroCollapseDecision(
          scrollOffset: 1,
          maxScrollExtent: 900,
          heroHeight: 200,
        ),
        HeroCollapseDecision.expand,
      );
    });
  });

  group('CollapsingHeroHeader — the widget', () {
    /// Home's own shape: the hero pinned above a scroll view whose content is
    /// [contentHeight] tall inside a [viewportHeight]-tall window.
    Future<ScrollController> pumpHome(
      WidgetTester tester, {
      required double contentHeight,
      double viewportHeight = 300,
    }) async {
      final ScrollController controller = ScrollController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              height: viewportHeight,
              child: CollapsingHeroHeader(
                config: _hero(),
                child: ListView(
                  controller: controller,
                  children: <Widget>[SizedBox(height: contentHeight)],
                ),
              ),
            ),
          ),
        ),
      );
      return controller;
    }

    /// The height the hero actually occupies — zero once collapsed, because
    /// `Align(heightFactor: 0)` reports zero for itself while still laying its
    /// child out. Measured on the ClipRect that wraps it, not on
    /// `CollapsingHeroHeader`, which now spans the whole screen it arranges.
    double heroHeight(WidgetTester tester) => tester
        .getSize(find
            .ancestor(
              of: find.byType(HeroHeader),
              matching: find.byType(ClipRect),
            )
            .first)
        .height;

    testWidgets('renders the hero at full height at rest', (tester) async {
      await pumpHome(tester, contentHeight: 2000);
      expect(find.text('Hi there'), findsOneWidget);
      expect(heroHeight(tester), greaterThan(0));
    });

    testWidgets('collapses to nothing once the visitor scrolls past the slack',
        (tester) async {
      final ScrollController controller =
          await pumpHome(tester, contentHeight: 2000);
      final double expanded = heroHeight(tester);

      controller.jumpTo(kHeroCollapseSlackPx + 50);
      await tester.pump();

      // Collapsed means GONE, not a short bar — no compact layer exists.
      expect(heroHeight(tester), 0);
      expect(expanded, greaterThan(0));
    });

    testWidgets('returns whole when the visitor scrolls back to the top',
        (tester) async {
      final ScrollController controller =
          await pumpHome(tester, contentHeight: 2000);
      final double expanded = heroHeight(tester);

      controller.jumpTo(kHeroCollapseSlackPx + 50);
      await tester.pump();
      expect(heroHeight(tester), 0);

      controller.jumpTo(0);
      await tester.pump();
      expect(heroHeight(tester), expanded);
    });

    // The oscillation, end to end: a Home barely taller than its window.
    // Without the layout guard the collapse frees the hero's height, the
    // offset clamps back to the top, the hero expands, and the two states
    // strobe. With it, the hero simply stays.
    testWidgets('refuses to collapse on a Home that barely overflows',
        (tester) async {
      final ScrollController controller =
          await pumpHome(tester, contentHeight: 260);
      final double expanded = heroHeight(tester);
      expect(expanded, greaterThan(0));

      controller.jumpTo(controller.position.maxScrollExtent);
      await tester.pump();

      expect(heroHeight(tester), expanded);
    });

    // A hero outside any scroll view never collapses, and that is correct
    // rather than degraded — the same answer the reference gives an
    // environment with no IntersectionObserver.
    testWidgets('renders expanded when its content does not scroll',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: CollapsingHeroHeader(
              config: _hero(),
              child: const SizedBox.shrink(),
            ),
          ),
        ),
      );
      expect(find.text('Hi there'), findsOneWidget);
      expect(heroHeight(tester), greaterThan(0));
    });

    // The merchant turned every piece of it off: no hero, and nothing for the
    // collapse to do either.
    testWidgets('renders nothing at all for an empty hero', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: CollapsingHeroHeader(
              config: testRemoteConfig(),
              child: const SizedBox.shrink(),
            ),
          ),
        ),
      );
      expect(heroHeight(tester), 0);
    });
  });
}
