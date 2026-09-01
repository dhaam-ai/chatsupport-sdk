import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import '../support/remote_config_fixtures.dart';

/// A minimal [UrlLauncherPlatform] fake — the plugin's own documented seam
/// (`UrlLauncherPlatform.instance` is a settable static precisely so a
/// platform call can be swapped out under test; see that class's own doc:
/// "Platform implementations should extend this class"). Records what was
/// launched instead of reaching a real platform channel, which
/// `flutter_test` has no implementation of.
class _FakeUrlLauncher extends UrlLauncherPlatform {
  final List<String> launched = <String>[];

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launched.add(url);
    return true;
  }
}

Widget _wrap(RemoteConfig config, VoidCallback onTryAgain) {
  return MaterialApp(home: Scaffold(body: UnavailableView(config: config, onTryAgain: onTryAgain)));
}

void main() {
  group('safeMailtoUri', () {
    test('a plain address becomes a mailto: URI', () {
      expect(safeMailtoUri('help@example.com'), Uri(scheme: 'mailto', path: 'help@example.com'));
    });

    test('trims surrounding whitespace', () {
      expect(safeMailtoUri('  help@example.com  '), Uri(scheme: 'mailto', path: 'help@example.com'));
    });

    test('null -> null, matching an unset console field', () {
      expect(safeMailtoUri(null), isNull);
    });

    test('blank -> null', () {
      expect(safeMailtoUri('   '), isNull);
    });

    test('no @ -> null', () {
      expect(safeMailtoUri('not-an-email'), isNull);
    });

    test('no dotted domain -> null', () {
      expect(safeMailtoUri('help@localhost'), isNull);
    });

    test('a header-injection attempt is refused outright, not encoded away', () {
      expect(safeMailtoUri('help@example.com\nBcc:evil@example.com'), isNull);
    });

    test('over the RFC 5321 mailbox length is refused', () {
      final String tooLong = '${'a' * 250}@example.com'; // 262 chars, > 254
      expect(safeMailtoUri(tooLong), isNull);
    });
  });

  group('UnavailableView', () {
    testWidgets('always renders the icon, heading and body copy', (tester) async {
      await tester.pumpWidget(_wrap(testRemoteConfig(), () {}));
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
      expect(find.text('Chat is temporarily unavailable'), findsOneWidget);
      expect(
        find.text(
          "We couldn't reach the support service. Try again, or email us and "
          "we'll pick it up from there.",
        ),
        findsOneWidget,
      );
    });

    testWidgets('tapping Try again calls onTryAgain', (tester) async {
      int calls = 0;
      await tester.pumpWidget(_wrap(testRemoteConfig(), () => calls++));

      await tester.tap(find.widgetWithText(FilledButton, 'Try again'));

      expect(calls, 1);
    });

    testWidgets('no email link when the console never set supportEmail', (tester) async {
      await tester.pumpWidget(_wrap(testRemoteConfig(), () {}));
      expect(find.textContaining('Email '), findsNothing);
    });

    testWidgets('no email link for a malformed supportEmail', (tester) async {
      await tester.pumpWidget(_wrap(testRemoteConfig(supportEmail: 'not-an-email'), () {}));
      expect(find.textContaining('Email '), findsNothing);
    });

    testWidgets('shows the merchant address and launches it when tapped', (tester) async {
      final _FakeUrlLauncher fake = _FakeUrlLauncher();
      final UrlLauncherPlatform original = UrlLauncherPlatform.instance;
      UrlLauncherPlatform.instance = fake;
      addTearDown(() => UrlLauncherPlatform.instance = original);

      await tester.pumpWidget(_wrap(testRemoteConfig(supportEmail: 'help@example.com'), () {}));
      expect(find.text('Email help@example.com'), findsOneWidget);

      await tester.tap(find.text('Email help@example.com'));

      expect(fake.launched, <String>['mailto:help@example.com']);
    });
  });
}
