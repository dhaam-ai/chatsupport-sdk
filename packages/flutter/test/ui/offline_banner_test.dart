// The offline bar: what it decides, and what it draws.
//
// Two halves, tested separately because they fail separately. The decision is
// a pure function over four inputs and is exhaustible; the widget is a
// rendering of one already-made decision and has nothing to decide.

import 'package:dhaam_chat/dhaam_chat.dart' show ConnectionState;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter_test/flutter_test.dart';

OfflineBannerView? resolve({
  ConnectionState connectionState = ConnectionState.reconnecting,
  bool online = true,
  int failedAttempts = 0,
  int queuedCount = 0,
}) =>
    resolveOfflineBanner(
      connectionState: connectionState,
      online: online,
      failedAttempts: failedAttempts,
      queuedCount: queuedCount,
    );

Future<void> pump(
  WidgetTester tester,
  OfflineBannerView? view, {
  Brightness brightness = Brightness.light,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(brightness: brightness),
      home: Scaffold(body: OfflineBanner(view: view)),
    ),
  );
  // MaterialApp wraps its theme in an AnimatedTheme, which LERPS between the
  // old palette and the new one over 200ms. A single `pumpWidget` leaves a
  // brightness change halfway through that interpolation — which is how a
  // test asserting on the dark palette reads back the light one and looks like
  // a bug in the widget. Settling is the whole difference.
  await tester.pumpAndSettle();
}

void main() {
  group('what the bar decides to say', () {
    test('nothing during a healthy first connect, or a single blip', () {
      expect(resolve(connectionState: ConnectionState.connecting), isNull);
      expect(resolve(failedAttempts: 1), isNull);
    });

    test('nothing once connected, when the platform agrees there is a network',
        () {
      expect(resolve(connectionState: ConnectionState.connected), isNull);
    });

    test('it speaks over a connected socket when the route is gone', () {
      // The asymmetry, and the case it exists for: a socket stays "open" until
      // a write fails or a keepalive expires — tens of seconds on mobile —
      // while the customer watches their signal bar empty and keeps typing.
      final OfflineBannerView? view =
          resolve(connectionState: ConnectionState.connected, online: false);

      expect(view?.tone, OfflineBannerTone.offline);
      expect(view?.message,
          'You’re offline. Messages will send when you’re back online.');
    });

    test('nothing for closed or suspended — neither is about the network', () {
      // `closed` is the host's own disconnect. `suspended` is a credential or
      // protocol fault the network cannot fix, and the client has STOPPED —
      // so promising a later delivery there would be a straight lie.
      expect(resolve(connectionState: ConnectionState.closed, online: false),
          isNull);
      expect(resolve(connectionState: ConnectionState.suspended, online: false),
          isNull);
    });

    test('offline outranks unreachable — it is the reason they are failing',
        () {
      expect(resolve(online: false, failedAttempts: 9)?.tone,
          OfflineBannerTone.offline);
    });

    test('unreachable only once the outage threshold is met', () {
      expect(resolve(failedAttempts: kOutageAttemptThreshold - 1), isNull);

      final OfflineBannerView? view =
          resolve(failedAttempts: kOutageAttemptThreshold);
      expect(view?.tone, OfflineBannerTone.unreachable);
      expect(view?.message, 'Can’t reach chat — still trying.');
    });

    test('it names the queued count, singular and plural', () {
      expect(
        resolve(online: false, queuedCount: 1)?.message,
        'You’re offline. 1 message will send when you’re back online.',
      );
      expect(
        resolve(online: false, queuedCount: 3)?.message,
        'You’re offline. 3 messages will send when you’re back online.',
      );
      expect(
        resolve(failedAttempts: 2, queuedCount: 2)?.message,
        'Can’t reach chat — 2 messages will send when we reconnect.',
      );
    });
  });

  group('what the bar draws', () {
    testWidgets('nothing at all for a null view', (WidgetTester tester) async {
      await pump(tester, null);
      expect(find.byIcon(Icons.wifi_off_rounded), findsNothing);
      expect(find.byType(Text), findsNothing);
    });

    testWidgets('the sentence, with a glyph beside it',
        (WidgetTester tester) async {
      await pump(tester, resolve(online: false, queuedCount: 2));

      expect(
          find.text(
              'You’re offline. 2 messages will send when you’re back online.'),
          findsOneWidget);
      expect(find.byIcon(Icons.wifi_off_rounded), findsOneWidget);
    });

    testWidgets('announced as a live region, not as an interruption',
        (WidgetTester tester) async {
      // The platform speaks it at the next pause. An alert would cut across
      // whatever is currently being read, and a dropped wifi does not earn
      // that.
      final SemanticsHandle handle = tester.ensureSemantics();
      await pump(tester, resolve(online: false));

      expect(
        tester.getSemantics(find.byType(OfflineBanner)),
        matchesSemantics(
          isLiveRegion: true,
          label: 'You’re offline. Messages will send when you’re back online.',
        ),
      );

      handle.dispose();
    });

    testWidgets('the two tones are visually distinct',
        (WidgetTester tester) async {
      await pump(tester, resolve(online: false));
      final Color offlineBg = _bannerColor(tester);

      await pump(tester, resolve(failedAttempts: 2));
      final Color unreachableBg = _bannerColor(tester);

      expect(offlineBg, isNot(unreachableBg));
    });

    testWidgets('dark mode is a different palette, not the light one dimmed',
        (WidgetTester tester) async {
      await pump(tester, resolve(online: false));
      final Color light = _bannerColor(tester);

      await pump(tester, resolve(online: false), brightness: Brightness.dark);
      final Color dark = _bannerColor(tester);

      expect(light, isNot(dark));
      // A pale amber band on a dark app is a headlight. The dark tone has to
      // be the dark one.
      expect(dark.computeLuminance(), lessThan(light.computeLuminance()));
    });
  });
}

Color _bannerColor(WidgetTester tester) {
  final Container container = tester.widget<Container>(
    find
        .descendant(
            of: find.byType(OfflineBanner), matching: find.byType(Container))
        .first,
  );
  return (container.decoration! as BoxDecoration).color!;
}
