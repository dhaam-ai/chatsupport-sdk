import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/remote_config_fixtures.dart';

Widget _wrap(RemoteConfig config) =>
    MaterialApp(home: Scaffold(body: HeroHeader(config: config)));

void main() {
  testWidgets(
      'renders nothing at all when the merchant configured no hero content',
      (tester) async {
    await tester.pumpWidget(_wrap(testRemoteConfig()));
    expect(find.byType(HeroHeader), findsOneWidget);
    // Not an empty coloured slab — see hero_header.dart's header on why
    // "empty" means no widget at all, matching hero-header.ts's own
    // data-empty rule.
    expect(
        find.descendant(
            of: find.byType(HeroHeader), matching: find.byType(Container)),
        findsNothing);
  });

  testWidgets('renders the greeting and sub-greeting', (tester) async {
    await tester.pumpWidget(
      _wrap(testRemoteConfig(
          header: const HeaderAppearance(
              greeting: 'Hi there', subGreeting: 'How can we help?'))),
    );
    expect(find.text('Hi there'), findsOneWidget);
    expect(find.text('How can we help?'), findsOneWidget);
  });

  testWidgets(
      'a logo only shows when showLogo is true, even with a URL present',
      (tester) async {
    const header =
        HeaderAppearance(showLogo: false, logoUrl: 'https://x.test/logo.png');
    await tester
        .pumpWidget(_wrap(testRemoteConfig(header: header, greeting: null)));
    // Nothing else configured either, and showLogo is false -> still empty.
    expect(
        find.descendant(
            of: find.byType(HeroHeader), matching: find.byType(Container)),
        findsNothing);
  });

  testWidgets(
      'renders an avatar stack, capped at kMaxHeroAvatars, filtering out unsafe URLs',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        testRemoteConfig(
          header: const HeaderAppearance(
            showAvatars: true,
            avatars: <String>[
              'https://x.test/a.png',
              'https://x.test/b.png',
              'javascript:alert(1)', // filtered by safeImageUrl
              'https://x.test/c.png',
              'https://x.test/d.png',
            ],
          ),
        ),
      ),
    );

    // 4 safe URLs survive the allowlist; kMaxHeroAvatars (3) caps the row.
    // Circular, bordered containers are this widget's one avatar-face
    // signature, so counting them is a robust proxy without reaching into
    // the private _AvatarStack type.
    final circleFaces = find.byWidgetPredicate(
      (widget) =>
          widget is Container &&
          widget.decoration is BoxDecoration &&
          (widget.decoration! as BoxDecoration).shape == BoxShape.circle &&
          (widget.decoration! as BoxDecoration).image != null,
    );
    expect(circleFaces, findsNWidgets(kMaxHeroAvatars));
  });

  testWidgets('the background colour resolves through headerBackgroundColor',
      (tester) async {
    const header = HeaderAppearance(backgroundColor: '#ff0000', greeting: 'Hi');
    await tester.pumpWidget(_wrap(testRemoteConfig(header: header)));

    final Container container = tester.widget<Container>(
      find
          .descendant(
              of: find.byType(HeroHeader), matching: find.byType(Container))
          .first,
    );
    expect((container.decoration! as BoxDecoration).color,
        const Color(0xFFFF0000));
  });
}
