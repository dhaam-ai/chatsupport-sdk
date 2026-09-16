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
/// ── Why this bundles an audio plugin, having once refused to ─────────────
///
/// This header used to argue the other way, and the argument was wrong in a
/// way worth recording rather than deleting. It ran: the reference
/// synthesises two sine notes with WebAudio rather than shipping a file,
/// Flutter has no WebAudio counterpart, [SystemSound] needs no plugin and no
/// permission, and [ChimePlayer] lets a host that already ships audio supply
/// its own player in one line.
///
/// Every clause of that is still true. What it missed is the consequence:
/// [SystemSoundType.alert] is documented as IGNORED on Android, iOS and web,
/// which is every platform a customer is actually on. So the shipped
/// behaviour of "the merchant enabled a notification sound" was silence, and
/// the seam that was supposed to rescue it put the entire feature behind work
/// each host had to discover and do. A sound that only exists if the
/// integrator writes code is a sound nearly nobody hears. The old note also
/// claimed "an honest rationale comment could not be written for that trade";
/// the trade it was weighing was a plugin against a WORKING [SystemSound],
/// and that was never the trade on offer.
///
/// So the default is now a real player over a bundled asset, and the seam is
/// unchanged: a host with its own audio stack still passes one closure.
///
/// ── What taking `audioplayers` costs, and what it does not ───────────────
///
/// It costs every host native audio code on six platforms. It does NOT cost
/// them a permission: `audioplayers_android`'s manifest declares none, and
/// `audioplayers_darwin` ships no privacy manifest and touches no capture
/// API. That is the whole difference between playing a file and opening a
/// microphone, and it is why `record` obliges hosts to write `Info.plist`
/// entries and this does not. `pubspec.yaml`'s entry carries the full
/// comparison against `just_audio` and `soundpool` and the pin that was
/// actually observed to resolve.
///
/// ── Why a FILE, when the reference explicitly refused one ────────────────
///
/// `chime.ts` refused an asset because "a widget that fetches a second
/// resource has a second thing that can fail on a merchant's page", and it
/// was right about the web: there the widget is a script on somebody else's
/// site and the asset is a network request. Here it is neither. A Flutter
/// asset is compiled into the host's application bundle, so there is no
/// fetch, no 404 and no second origin — the failure mode the reference was
/// avoiding does not exist on this platform. What survives is its other
/// concern, size, and the answer is 12 KB.
///
/// The bytes are the reference's own chime rather than a tone somebody
/// picked: `test/support/reference_chime.dart` renders `chime.ts`'s two
/// oscillators — the rising fifth, the sine, the exponential envelope — and
/// `test/ui/header/chime_asset_test.dart` asserts the committed file still
/// is that. The WAVE container is `wavFromPcm16`, the writer this package
/// already ships for voice notes; there is one WAVE writer here, not two.
library;

import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:flutter/services.dart';

import '../../storage/chat_storage.dart';

/// Makes the sound. Must not throw; [Chime] guards it anyway.
typedef ChimePlayer = Future<void> Function();

/// Builds the player. Called at most once, on the first chime that is
/// actually permitted — see [Chime.play].
typedef ChimePlayerFactory = ChimePlayer Function();

/// Where the bundled chime lives inside THIS package.
///
/// The same literal `pubspec.yaml` registers under `flutter: assets:`;
/// `chime_asset_test.dart` asserts the two have not drifted.
const String kChimeAssetPath = 'assets/chime.wav';

/// The key the chime has in a HOST application's asset bundle.
///
/// Not the same string as [kChimeAssetPath], and the difference is not
/// cosmetic. Flutter rewrites a DEPENDENCY package's assets under
/// `packages/<package>/`, leaving a root application's alone — flutter_tools'
/// `asset.dart` builds precisely that Uri, commented "Asset from, and
/// declared in $packageName". Every real host of this library is the first
/// case, so this is what reaches `rootBundle`.
///
/// One consequence worth stating, because it looks like a bug the first time
/// it is met: inside THIS package's own test run the package is the root
/// application, so the asset is keyed `assets/chime.wav` and a lookup of the
/// string below finds nothing. That is why `chime_asset_test.dart` reads the
/// file from disk rather than through `rootBundle`.
const String kChimeAssetKey = 'packages/dhaam_chat_flutter/$kChimeAssetPath';

/// The DEFAULT player: the bundled chime, through the platform's audio stack.
///
/// A [ChimePlayerFactory], not a [ChimePlayer]: everything costly happens
/// when this is CALLED, which [Chime] does at most once and only for a chime
/// that is actually going to be heard. A muted visitor never reaches this
/// function, so no audio player is constructed and the asset is never read.
ChimePlayer bundledChimePlayer() {
  final AudioPlayer player = AudioPlayer()
    // `AudioCache`'s default prefix is `assets/`, which it prepends to the
    // [AssetSource] path before asking the bundle. [kChimeAssetKey] is
    // already the complete key, so the prefix has to be emptied — left at the
    // default the lookup becomes `assets/packages/...` and silently misses.
    // Set on this player only; `AudioCache.instance` is global and belongs to
    // the host.
    ..audioCache = AudioCache(prefix: '');
  // `ReleaseMode.stop` keeps the prepared source between chimes instead of
  // tearing the native player down after each one. A chime plays repeatedly
  // in a session, and re-preparing the same 12 KB every time is work for
  // nothing.
  //
  // The call carries a second, load-bearing job. `AudioPlayer` builds its
  // native player asynchronously and parks any failure on a completer that
  // is only awaited once a SOURCE is being set; when the asset lookup fails
  // first — an unsupported platform, a stripped bundle — that error is left
  // with no listener, and an unlistened asynchronous error surfaces in the
  // host app as a zone error. This library's header forbids exactly that: a
  // chime failing on every message would drown the failures a host actually
  // needs to see. `setReleaseMode` awaits that same completer, so this is
  // what gives the error a listener; its own rejection is caught here.
  unawaited(player.setReleaseMode(ReleaseMode.stop).catchError((Object _) {}));
  return () => player.play(AssetSource(kChimeAssetKey));
}

/// The platform's own short alert sound. No longer the default.
///
/// Kept because it is still the right answer for a DESKTOP-only host that
/// would rather use the system alert than ship 12 KB — and removing a
/// published symbol to make a point is a breaking change for no one's
/// benefit. Pass it as `Chime(createPlayer: () => playSystemChime)`.
///
/// Not the default, because [SystemSoundType.alert] is documented as ignored
/// on Android, iOS and web. It was the default once; see this library's
/// header for why that was wrong and what replaced it.
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
      : _createPlayer = createPlayer ?? bundledChimePlayer;

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

/// The name this decision is stored under, inside the per-publishable-key
/// namespace [chatStorageKey] builds.
///
/// Matches the reference's `chatsdk:${publishableKey}:muted` exactly, the same
/// way `kConsentStorageName` matches its own.
const String kMutedStorageName = 'muted';

/// What a silenced chime is recorded as.
///
/// Compared against rather than tested for presence, exactly as
/// `kConsentStoredValue` is: anything else under this key is somebody else's
/// data, not a decision this widget made.
const String kMutedStoredValue = 'true';

/// What a restored chime is recorded as. See [MuteMemory.recordMuted] for why
/// an un-mute writes a value rather than removing the key.
const String kUnmutedStoredValue = 'false';

/// The memory of whether THIS visitor silenced the chime.
///
/// ── Why it lives beside the chime and not inside the store ───────────────
///
/// `ChatStorage` deliberately holds no policy — its own header says a failed
/// read is reported, never interpreted, so "the rule lives with the decision
/// it protects instead of being smeared across every implementation". The
/// decision this protects is the chime, so the rule is here, exactly as the
/// consent notice's rule is in `ui/consent/consent_gate.dart`.
///
/// ── The reference's key, not a new one ───────────────────────────────────
///
/// `chatsdk:<publishableKey>:muted`, which is what `ui/header-menu.ts` writes
/// in the browser, built by [chatStorageKey] so a merchant reading a web
/// install and an app install side by side sees one key shape rather than
/// two. Keyed per publishable key because two tenants on one device must not
/// silence each other.
class MuteMemory {
  /// A memory that survives the app.
  ///
  /// [publishableKey] is spent here, at construction, so no caller downstream
  /// can build the key a second way — the same reason `ConsentGate` takes it
  /// here and not at each call.
  MuteMemory({
    required ChatStorage storage,
    required PublishableKey publishableKey,
    this.onError,
  })  : _storage = storage,
        _key = chatStorageKey(publishableKey, kMutedStorageName);

  /// A memory that forgets when the widget goes away. The default.
  ///
  /// Exactly what `ChatWidgetState.muted` did before any of this existed: the
  /// switch is honoured for as long as the widget is up and returns to
  /// un-muted on the next mount. A host that wants it remembered passes the
  /// other constructor with a [SharedPreferencesChatStorage].
  ///
  /// The key is unqualified on purpose: a [MemoryChatStorage] built for this
  /// one memory holds nothing else and dies with it, so there is no second
  /// tenant to be kept apart from.
  MuteMemory.unremembered({this.onError})
      : _storage = MemoryChatStorage(),
        _key = kMutedStorageName;

  final ChatStorage _storage;
  final String _key;

  /// Where a storage failure is reported. The customer never sees one — a
  /// device that blocks app data is a setting they are entitled to, not an
  /// error to put in front of them.
  final void Function(Object error, StackTrace stackTrace)? onError;

  /// Whether this visitor silenced the chime last time.
  ///
  /// A read that FAILS resolves `false`, the same as a first visit. That
  /// collapse is a decision, and it is made HERE rather than in
  /// [ChatStorage], which reports "absent" and "could not read" as different
  /// facts precisely so this one caller can choose. `false` is the safe
  /// direction in both senses: it is what the widget already says, so a
  /// failed read changes nothing, and the cost of being wrong is one chime a
  /// visitor can silence again rather than a notification they never receive.
  Future<bool> readMuted() async {
    try {
      return (await _storage.read(_key)) == kMutedStoredValue;
    } catch (error, stackTrace) {
      onError?.call(error, stackTrace);
      return false;
    }
  }

  /// Records that this visitor has, or has no longer, silenced the chime.
  ///
  /// An un-mute writes [kUnmutedStoredValue] rather than removing the key.
  /// [ChatStorage] has no `remove` — its header says why one was not ported —
  /// and "stored false" is in any case the more honest record: it says this
  /// visitor decided, which an absent key does not.
  ///
  /// Never rejects. The caller has already honoured the switch before this
  /// runs, and a device that cannot record it should not cost the visitor the
  /// setting they just chose; the price of the failure is only that the
  /// switch is back to un-muted on the next launch.
  Future<void> recordMuted(bool muted) async {
    try {
      await _storage.write(
        _key,
        muted ? kMutedStoredValue : kUnmutedStoredValue,
      );
    } catch (error, stackTrace) {
      onError?.call(error, stackTrace);
    }
  }
}
