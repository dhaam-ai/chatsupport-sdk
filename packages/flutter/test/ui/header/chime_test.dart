import 'dart:convert';
import 'dart:typed_data';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

/// The chime's gate and its silence. `chime.ts` has no test file of its own in
/// the reference — its behaviour is asserted through `header-menu.test.ts`'s
/// mute state and `widget.ts`'s unread selector — so these are the first
/// direct assertions this behaviour has had on either side.
/// Intercepts asset-bundle reads and records the keys asked for, answering
/// "no such asset" to every one.
///
/// `rootBundle` talks to the platform over the `flutter/assets` channel, so
/// mocking it is how a test sees WHICH asset a player reached for without
/// needing the asset, an audio device or a plugin.
List<String> _recordAssetRequests() {
  final List<String> requested = <String>[];
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMessageHandler('flutter/assets', (ByteData? message) async {
    requested.add(utf8.decode(message!.buffer.asUint8List()));
    return null;
  });
  addTearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMessageHandler('flutter/assets', null),
  );
  return requested;
}

void main() {
  /// A [Chime] wired to a recording player, plus the two counters the tests
  /// below assert on: how many times a player was BUILT (laziness) and how
  /// many times one was CALLED (the gate).
  ({Chime chime, List<int> plays, List<int> builds}) build({
    bool playerRejects = false,
  }) {
    final List<int> plays = <int>[];
    final List<int> builds = <int>[];
    final Chime chime = Chime(
      createPlayer: () {
        builds.add(builds.length);
        return () async {
          plays.add(plays.length);
          if (playerRejects) throw StateError('no output device');
        };
      },
    );
    return (chime: chime, plays: plays, builds: builds);
  }

  group('both parties have to agree', () {
    test('plays when the merchant enabled sound and the visitor has not muted',
        () {
      final built = build();
      built.chime.play(sound: true, muted: false);
      expect(built.plays, hasLength(1));
    });

    test('silent when the merchant never enabled it', () {
      final built = build();
      built.chime.play(sound: false, muted: false);
      expect(built.plays, isEmpty);
    });

    test(
        'silent when this visitor muted it, however the merchant configured '
        'it', () {
      final built = build();
      built.chime.play(sound: true, muted: true);
      expect(built.plays, isEmpty);
    });

    test('an unreadable config is not consent to play a sound', () {
      // The default is the gate: a widget whose config never landed must not
      // make noise on somebody's device.
      expect(defaultRemoteConfig.sound, isFalse);
      final built = build();
      built.chime.play(sound: defaultRemoteConfig.sound, muted: false);
      expect(built.plays, isEmpty);
    });
  });

  group('lazily constructed', () {
    test('builds nothing at construction', () {
      final built = build();
      expect(built.chime.isInitialised, isFalse);
      expect(built.builds, isEmpty);
    });

    test(
        'builds nothing for a refused chime — a muted visitor on a '
        'sound-enabled tenant allocates no player at all', () {
      final built = build();
      built.chime.play(sound: true, muted: true);
      built.chime.play(sound: false, muted: false);
      expect(built.chime.isInitialised, isFalse);
      expect(built.builds, isEmpty);
    });

    test('builds exactly once, on the first permitted call', () {
      final built = build();
      built.chime.play(sound: true, muted: false);
      built.chime.play(sound: true, muted: false);
      built.chime.play(sound: true, muted: false);
      expect(built.builds, hasLength(1));
      expect(built.plays, hasLength(3));
      expect(built.chime.isInitialised, isTrue);
    });
  });

  group('every failure is silent', () {
    test('a factory that throws does not reach the caller', () {
      final Chime chime = Chime(
        createPlayer: () => throw StateError('no audio session'),
      );
      expect(() => chime.play(sound: true, muted: false), returnsNormally);
    });

    test('a player that rejects does not surface as an unhandled zone error',
        () async {
      // The one that matters most: an unawaited rejection from a chime would
      // reach the host app's zone as an error, which is the loudest possible
      // outcome for the quietest possible feature.
      final built = build(playerRejects: true);
      expect(
          () => built.chime.play(sound: true, muted: false), returnsNormally);
      await Future<void>.delayed(Duration.zero);
      expect(built.plays, hasLength(1));
    });

    test('the REAL default player is silent when nothing can answer it',
        () async {
      // The default player against a test binding: no audio plugin
      // registered and no asset in this root package's bundle under the key
      // a HOST would see. Both fail, and both must fail quietly.
      //
      // This is also the one case that exercises `AudioPlayer`'s own
      // asynchronous creation failure. That failure is parked on a completer
      // which is only awaited AFTER the asset lookup, so when the lookup
      // fails first nobody is listening to it — and an unlistened
      // asynchronous error becomes an unhandled zone error in the host app,
      // which is the loudest possible outcome for the quietest possible
      // feature. `bundledChimePlayer`'s `setReleaseMode` call is what gives
      // that error a listener; remove it and this test reports the zone
      // error instead of passing.
      TestWidgetsFlutterBinding.ensureInitialized();
      final List<String> requested = _recordAssetRequests();

      final Chime chime = Chime();
      expect(() => chime.play(sound: true, muted: false), returnsNormally);
      await pumpEventQueue();

      expect(requested, isNotEmpty);
    });
  });

  group('the default player is the bundled chime', () {
    // The honest failure behind this whole change — "the notification sound
    // does not play on a phone" — cannot be asserted here: there is no audio
    // device, no platform channel and nobody listening. What CAN be asserted
    // is the thing that was actually wrong, which is WHICH player the
    // package wires when a host supplies none. The old default was
    // `SystemSound.alert`, documented as ignored on Android, iOS and web;
    // this pins that the default now reaches for the asset instead.
    test('asks the bundle for the asset this package ships', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      final List<String> requested = _recordAssetRequests();

      Chime().play(sound: true, muted: false);
      await pumpEventQueue();

      expect(requested, contains(kChimeAssetKey));
    });

    test('asks for nothing at all when the chime is refused', () async {
      // Laziness, asserted against the REAL player rather than a fake: a
      // muted visitor must not cause an audio player to be constructed or
      // the asset to be read.
      TestWidgetsFlutterBinding.ensureInitialized();
      final List<String> requested = _recordAssetRequests();

      final Chime chime = Chime();
      chime.play(sound: true, muted: true);
      chime.play(sound: false, muted: false);
      await pumpEventQueue();

      expect(chime.isInitialised, isFalse);
      expect(requested, isEmpty);
    });
  });

  group('playOnUnreadRise', () {
    test(
        'never on the first observation — that is a restored backlog, not a '
        'new reply', () {
      final built = build();
      built.chime.playOnUnreadRise(unread: 7, sound: true, muted: false);
      expect(built.plays, isEmpty);
    });

    test('plays on a rise', () {
      final built = build();
      built.chime.playOnUnreadRise(unread: 0, sound: true, muted: false);
      built.chime.playOnUnreadRise(unread: 1, sound: true, muted: false);
      expect(built.plays, hasLength(1));
    });

    test(
        'silent on a fall — opening the panel zeroes the count and that is '
        'the customer reading, not a reply arriving', () {
      final built = build();
      built.chime.playOnUnreadRise(unread: 3, sound: true, muted: false);
      built.chime.playOnUnreadRise(unread: 0, sound: true, muted: false);
      expect(built.plays, isEmpty);
    });

    test('silent when the count merely repeats', () {
      final built = build();
      built.chime.playOnUnreadRise(unread: 2, sound: true, muted: false);
      built.chime.playOnUnreadRise(unread: 2, sound: true, muted: false);
      expect(built.plays, isEmpty);
    });

    test(
        'records the count even while muted, so un-muting does not chime for '
        'a backlog', () {
      final built = build();
      built.chime.playOnUnreadRise(unread: 0, sound: true, muted: true);
      built.chime.playOnUnreadRise(unread: 5, sound: true, muted: true);
      expect(built.plays, isEmpty);

      // Un-muted, and the count has not moved since. Nothing to announce.
      built.chime.playOnUnreadRise(unread: 5, sound: true, muted: false);
      expect(built.plays, isEmpty);

      // The next real arrival does play.
      built.chime.playOnUnreadRise(unread: 6, sound: true, muted: false);
      expect(built.plays, hasLength(1));
    });
  });
}
