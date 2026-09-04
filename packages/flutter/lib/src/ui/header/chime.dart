/// The notification sound — `behaviour.sound` in the console's "During the
/// chat" group, described there as "Plays on the visitor's side when a reply
/// arrives."
///
/// Ports `packages/widget/src/ui/chime.ts`.
///
/// ── Two parties have to agree ────────────────────────────────────────────
///
/// `RemoteConfig.sound` is the merchant deciding whether a chime exists at
/// all; `ChatWidgetState.muted` is the person in front of the screen deciding
/// they have heard enough of it. [Chime] is the one place the two are
/// combined, so no caller can satisfy one and forget the other.
///
/// `RemoteConfig.sound` defaults to FALSE, and that default is load-bearing:
/// an unreadable config is not consent to make noise on somebody's device.
///
/// ── Why a failure here is silent ─────────────────────────────────────────
///
/// This runs on the message-arrival path, where a sound is by far the least
/// important thing occurring. A platform with no output device, a channel
/// that is not implemented, a host-supplied player that throws — all three
/// end in the same place, which is nothing happening and nothing thrown. The
/// alternative is an exception raised while a customer is being handed a
/// reply.
///
/// ── Why there is no audio plugin, and what was actually checked ──────────
///
/// The reference synthesises two sine notes with WebAudio rather than
/// shipping a file, and states why: "a widget that fetches a second resource
/// has a second thing that can fail on a merchant's page." Flutter has no
/// WebAudio counterpart, so the equivalent choice is between a plugin and the
/// framework's own [SystemSound].
///
/// `audioplayers` WAS checked rather than assumed: `flutter pub get` resolves
/// it at 6.4.0 on the Dart 3.5.4 this repo pins, pulling six packages
/// (`audioplayers` plus one federated implementation per platform). So the
/// blocker is not resolution — it is what taking it would cost and buy. It
/// plays SOURCES, so a two-note chime means either a binary asset committed
/// to this repo (the thing `chime.ts` explicitly refused) or a hand-written
/// PCM/WAV encoder, and either way every host of this library links native
/// audio code on six platforms. `chime.ts`'s own header calls the sound "by
/// far the least important thing occurring" on this path, and an honest
/// rationale comment — which this package requires of every dependency — could
/// not be written for that trade. So it was not taken.
///
/// [SystemSound] is the framework's own, needs no asset, no plugin and no
/// permission. Its limitation is real and is not papered over here:
/// [SystemSoundType.alert] is documented as desktop-only and is IGNORED on
/// Android, iOS and web. That is why [ChimePlayer] is a seam rather than a
/// hard-coded call — a host that already ships an audio package supplies it
/// in one line, and this library does not oblige every other host to take one
/// for a chime.
library;

import 'dart:async';

import 'package:flutter/services.dart';

/// Makes the sound. Must not throw; [Chime] guards it anyway.
typedef ChimePlayer = Future<void> Function();

/// Builds the player. Called at most once, on the first chime that is
/// actually permitted — see [Chime.play].
typedef ChimePlayerFactory = ChimePlayer Function();

/// The default player: the platform's own short alert sound.
///
/// A no-op on Android, iOS and web, where [SystemSoundType.alert] is
/// documented as ignored. See this library's header for why that is the
/// accepted default rather than a plugin, and [ChimePlayer] for how a host
/// replaces it.
/// https://api.flutter.dev/flutter/services/SystemSoundType.html
Future<void> playSystemChime() => SystemSound.play(SystemSoundType.alert);

/// The chime, and the two questions that gate it.
///
/// ── Lazily constructed ───────────────────────────────────────────────────
///
/// The player is built on the FIRST call that gets past the gate, never at
/// mount. Two reasons pointing the same way, both the reference's: a widget
/// that never plays a sound should never have allocated an audio graph, and a
/// host-supplied player may hold a real device handle that should not exist
/// until there is something to play.
///
/// A muted visitor on a sound-enabled tenant therefore allocates nothing at
/// all, which a construct-at-mount design cannot manage.
class Chime {
  Chime({ChimePlayerFactory? createPlayer})
      : _createPlayer = createPlayer ?? _defaultFactory;

  static ChimePlayer _defaultFactory() => playSystemChime;

  final ChimePlayerFactory _createPlayer;
  ChimePlayer? _player;

  /// The last unread count [playOnUnreadRise] was shown, or null until it has
  /// been shown one. See that method.
  int? _lastUnread;

  /// Whether a player has been built. Exposed so a test can assert the
  /// laziness rather than infer it.
  bool get isInitialised => _player != null;

  /// Plays, if both the merchant and this visitor allow it.
  ///
  /// Never throws, never returns a future to await: the caller is on the
  /// message-arrival path and has nothing useful to do with either.
  void play({required bool sound, required bool muted}) {
    // Both, and in this order only because reading it aloud matches the
    // sentence: the merchant enabled a chime, and this visitor has not
    // silenced it.
    if (!sound || muted) return;
    try {
      final ChimePlayer player = _player ??= _createPlayer();
      // Fire and forget, with the rejection swallowed explicitly. An
      // unhandled asynchronous error from a chime would surface as a zone
      // error in the host app — the loudest possible outcome for the
      // quietest possible feature.
      unawaited(player().catchError((Object _) {}));
    } catch (_) {
      // A factory or a synchronous throw from the player. Silent, per the
      // library header. Deliberately not routed to `onError` either: the
      // reference reports it, but the reference's `onError` is the widget's
      // one error channel and a chime failing on every message would drown
      // the failures a host actually needs to see.
    }
  }

  /// Plays only when [unread] has gone UP since the last time this was shown
  /// a count.
  ///
  /// ── Strictly on the way up, and never on the first observation ────────
  ///
  /// `unreadCount` also FALLS — to zero, when the panel opens — and a widget
  /// that chimed on any change would announce the customer's own act of
  /// reading. The first observation is likewise recorded and never played:
  /// it is whatever a restored session already had, so chiming on it greets
  /// a returning visitor with a noise about messages they have already read.
  ///
  /// The count is recorded even when the gate refuses, so un-muting does not
  /// then chime for a backlog that accumulated while the visitor was muted.
  void playOnUnreadRise({
    required int unread,
    required bool sound,
    required bool muted,
  }) {
    final int? previous = _lastUnread;
    _lastUnread = unread;
    if (previous == null || unread <= previous) return;
    play(sound: sound, muted: muted);
  }
}
