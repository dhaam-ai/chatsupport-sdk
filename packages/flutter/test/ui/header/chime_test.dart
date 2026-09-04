import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// The chime's gate and its silence. `chime.ts` has no test file of its own in
/// the reference — its behaviour is asserted through `header-menu.test.ts`'s
/// mute state and `widget.ts`'s unread selector — so these are the first
/// direct assertions this behaviour has had on either side.
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

    test('a missing platform channel is silent too', () async {
      // The real default player against a binding with no handler registered
      // — which is what an unsupported platform looks like from here.
      TestWidgetsFlutterBinding.ensureInitialized();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (_) async {
        throw MissingPluginException('SystemSound.play');
      });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, null),
      );

      final Chime chime = Chime();
      expect(() => chime.play(sound: true, muted: false), returnsNormally);
      await Future<void>.delayed(Duration.zero);
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
