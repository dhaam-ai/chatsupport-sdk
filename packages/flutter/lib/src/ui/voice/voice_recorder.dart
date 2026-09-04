/// Recording a voice note: the lifecycle, and the rule that the device is
/// released on every way out of it.
///
/// Ports the recorder half of `packages/widget/src/ui/voice.ts`. There is no
/// widget test for that file — it is browser-only — so the reference source
/// is this port's specification, and the four rules its header calls out are
/// reproduced here as four things a test can actually assert.
///
/// ── The seam is the DEVICE, not the recorder ─────────────────────────────
///
/// [VoiceRecorder] is a concrete class, not an interface. Everything that
/// makes this module worth porting — the release discipline, the taxonomy,
/// the best-effort meter, the cancel-while-prompting window — lives above
/// [VoiceDevice], which has five methods and no policy at all.
///
/// That split is the point. Were the seam the whole recorder, each platform
/// adapter would re-implement "release on every exit path" and each would be
/// a place to get it wrong; a fake in a test would satisfy the interface
/// while asserting nothing about the rule. As written, one fake device proves
/// the rule for every adapter that will ever exist.
///
/// ── Nothing here is logged ───────────────────────────────────────────────
///
/// §14, and this module takes it literally: not the error, not the mime type,
/// not the byte count, and above all not the audio. There is no `debugPrint`,
/// no `onError` reporter and no rethrow in this file. A [VoiceDevice] that
/// throws has its exception turned into a [VoiceError] code and dropped —
/// see `voice_error.dart` on why even the code carries no platform prose.
library;

import 'dart:async';
import 'dart:typed_data';

import '../attachments/attachment_draft.dart' show PickedAttachment;
import 'voice_error.dart';

/// How often the level meter and the elapsed clock update while recording.
///
/// `voice.ts`'s own `AMPLITUDE_INTERVAL_MS`. Roughly 20 frames a second: fast
/// enough that the meter reads as live, slow enough that it is not competing
/// with the recording for the platform thread.
const Duration kVoiceTickInterval = Duration(milliseconds: 50);

/// Elapsed time and a 0..1 level, about twenty times a second while
/// recording.
///
/// [level] is already clamped and is never NaN — see [VoiceRecorder], which
/// does that so no caller has to defend a progress bar against a device that
/// returned nonsense.
typedef VoiceTick = void Function(Duration elapsed, double level);

/// The platform half of recording, and the whole of what a host must supply.
///
/// ── Five methods, no policy ──────────────────────────────────────────────
///
/// An implementation answers questions and moves bytes. It does not decide
/// when to release, does not run a clock, does not classify its own failures
/// beyond [VoiceDeviceException], and never has to remember a rule. All of
/// that is [VoiceRecorder]'s, which is why a wrong adapter is a shallow bug
/// rather than a silent microphone.
///
/// ── This package ships no implementation, on purpose ─────────────────────
///
/// See `voice.dart` for the dependency decision and the verified versions.
/// The short form: a recording plugin links native capture code on six
/// platforms and obliges every host — including the ones that never show the
/// button — to declare a microphone usage string, and the recording it
/// produces has nowhere to go until the attachment draft can accept one.
abstract interface class VoiceDevice {
  /// Asks for the microphone, prompting if the platform will.
  ///
  /// Returns what the platform actually said. An implementation that cannot
  /// distinguish a dismissed prompt from a permanent refusal must return
  /// [VoicePermission.denied] — see that enum for why that is the safe half.
  Future<VoicePermission> requestPermission();

  /// Begins capturing. Called only after [requestPermission] granted.
  Future<void> start();

  /// Finishes capturing and returns the audio, or `null` if there is none.
  ///
  /// Must not release the device — [VoiceRecorder] calls [release] itself, on
  /// this path and on every other.
  Future<Uint8List?> stop();

  /// The current input level, 0..1.
  ///
  /// Best-effort by contract: this may throw, and [VoiceRecorder] will
  /// swallow it and keep recording. See [VoiceRecorder.start].
  Future<double> level();

  /// Stops every track and hands the microphone back.
  ///
  /// **Idempotent, and safe to call when idle** — [VoiceRecorder] calls it on
  /// paths where nothing was ever started, and calls it more than once. May
  /// throw; that is swallowed too, because a failure to release is not
  /// something a customer can act on.
  Future<void> release();

  /// The media type of what [stop] returns, e.g. `audio/webm`.
  String get mimeType;
}

/// A finished voice note.
class VoiceRecording {
  const VoiceRecording({
    required this.bytes,
    required this.mimeType,
    required this.duration,
  });

  final Uint8List bytes;
  final String mimeType;

  /// How long the recording ran, to the nearest tick.
  ///
  /// ── Tick-derived, where the reference uses the wall clock ────────────
  ///
  /// `voice.ts` subtracts two `Date.now()` readings. This counts the ticks
  /// that actually fired, and the difference is deliberate: the same number
  /// drives the timer the customer watched while recording, so the label they
  /// saw and the length recorded here cannot disagree. A device or an
  /// application thread stalled badly enough to lose ticks is one that had
  /// also frozen the display, and a duration that silently disagreed with
  /// what was on screen would be the more confusing of the two failures.
  final Duration duration;

  /// What to call the file when this becomes an attachment.
  ///
  /// `composer.ts`'s own rule — `mimeType.includes('mp4') ? 'm4a' : 'webm'` —
  /// kept, and widened once, deliberately.
  ///
  /// `package:mime`'s `extensionFromMime` was the obvious generalisation and
  /// was checked rather than assumed: it maps `audio/webm` to **`weba`**, not
  /// `webm`. That is defensible as a spec answer and wrong as a product one —
  /// the agent at the other end downloads the result, and `.weba` is the
  /// extension their player is least likely to open. So the mapping stays a
  /// short explicit table rather than becoming a library call.
  ///
  /// ── The `wav` case, and why it is not an inherited default ────────────
  ///
  /// This method's earlier form said that "an adapter that emits neither
  /// webm nor mp4 should widen this deliberately rather than inherit `webm`
  /// by default", and [RecordVoiceDevice] is that adapter: `record`'s only
  /// encoder available on all six platforms in stream mode is `pcm16bits`,
  /// which this package wraps in a WAVE header (see `wav.dart`). Letting
  /// `audio/wav` fall through to `.webm` would name the file after a
  /// container it is not in — the agent's player would refuse it, or worse,
  /// open it and produce noise.
  ///
  /// An unrecognised type still falls through to `webm`, which is the
  /// reference's own answer and the right one for the browser adapter the
  /// rule was written for.
  String get fileName {
    final String type = mimeType.split(';').first.trim().toLowerCase();
    final String extension = switch (type) {
      _ when type.contains('mp4') => 'm4a',
      _ when type.contains('wav') => 'wav',
      _ => 'webm',
    };
    return 'voice-message.$extension';
  }
}

enum _Stage { idle, starting, recording, disposed }

/// The recorder: a lifecycle over a [VoiceDevice], and four guarantees.
///
/// ── 1. Every exit path releases the device ───────────────────────────────
///
/// [stop], [cancel], [dispose] and every failure inside [start] all funnel
/// through one private `_release`. This is the rule `voice.ts` names first,
/// and its reason is not tidiness: a live capture keeps the operating
/// system's microphone indicator lit after the widget is gone, which a person
/// looking at their status bar quite reasonably reads as the app still
/// listening to them.
///
/// ── 2. A broken level meter never costs the customer their audio ─────────
///
/// [VoiceDevice.level] is called inside a try/catch that reports zero and
/// carries on. A device that refuses to build a meter — an exhausted audio
/// graph, a platform that has no such API — must still record.
///
/// ── 3. Cancelling during the permission prompt is honoured ───────────────
///
/// The prompt is the longest await in the class and the customer is looking
/// at a system dialog, not at this widget. If they dismiss the whole panel
/// while it is up, [start] must not go on to open a microphone for a UI that
/// no longer exists. Checked after the prompt resolves, exactly as `voice.ts`
/// checks after `getUserMedia`.
///
/// ── 4. Nothing is logged ─────────────────────────────────────────────────
///
/// See this library's header.
class VoiceRecorder {
  VoiceRecorder({
    required VoiceDevice device,
    VoiceTick? onTick,
    Duration tickInterval = kVoiceTickInterval,
  })  : _device = device,
        _onTick = onTick,
        _tickInterval = tickInterval;

  final VoiceDevice _device;
  final VoiceTick? _onTick;
  final Duration _tickInterval;

  _Stage _stage = _Stage.idle;
  Timer? _timer;
  Duration _elapsed = Duration.zero;

  /// Set by [cancel] and [dispose], read at every await boundary in [start]
  /// and [stop]. See guarantee 3.
  bool _cancelled = false;

  /// Whether audio is being captured right now.
  bool get isRecording => _stage == _Stage.recording;

  /// How long the current recording has been running.
  ///
  /// Zero when idle. Exposed so a UI rebuilding for its own reasons can draw
  /// the timer without having had to keep its own copy of the last tick.
  Duration get elapsed => _elapsed;

  /// Starts recording, or returns why it could not.
  ///
  /// Resolves `null` on success **and** when the customer cancelled while the
  /// permission prompt was up — both mean "there is nothing to tell them",
  /// which is the same pair `voice.ts` collapses for the same reason.
  Future<VoiceError?> start() async {
    if (_stage == _Stage.disposed) {
      return VoiceError.of(VoiceErrorCode.recorderFailed);
    }
    // Already running. Not an error and not a restart: a second tap on a
    // recording button is the STOP gesture, and the caller decides that.
    if (_stage != _Stage.idle) return null;

    _cancelled = false;
    _elapsed = Duration.zero;
    _stage = _Stage.starting;

    final VoicePermission permission;
    try {
      permission = await _device.requestPermission();
    } catch (error) {
      await _release();
      return classifyVoiceException(error);
    }

    final VoiceError? refused = voicePermissionError(permission);
    if (refused != null) {
      await _release();
      return refused;
    }

    // Guarantee 3. The prompt was up; the panel may be gone.
    if (_cancelled || _stage == _Stage.disposed) {
      await _release();
      return null;
    }

    try {
      await _device.start();
    } catch (error) {
      await _release();
      return classifyVoiceException(error);
    }

    // Cancelled while the device was opening. The bytes have started; drop
    // them and hand the microphone straight back.
    if (_cancelled || _stage == _Stage.disposed) {
      await _release();
      return null;
    }

    _stage = _Stage.recording;
    _timer = Timer.periodic(_tickInterval, (Timer _) => unawaited(_tick()));
    return null;
  }

  /// Stops recording and returns the note, or `null` when there is nothing to
  /// send.
  ///
  /// `null` covers three cases the caller treats identically: it was not
  /// recording, the device produced no audio, and the recording was cancelled
  /// while stopping. All three end with the device released.
  Future<VoiceRecording?> stop() async {
    if (_stage != _Stage.recording) {
      // `voice.ts` releases here too, even though nothing was started. It is
      // the cheapest possible way to make "the microphone is off" true after
      // any call to stop, whatever state the caller believed it was in.
      await _release();
      return null;
    }

    // Before the first await, not after it. `_release` below also cancels
    // the timer, but it sits behind `_device.stop()` — and a tick firing in
    // that window would advance the clock and move the meter for a recording
    // the customer has already ended.
    _stopTicker();
    final Duration duration = _elapsed;
    final String mimeType = _device.mimeType;

    Uint8List? bytes;
    try {
      bytes = await _device.stop();
    } catch (_) {
      // Swallowed, but the release below still runs — which is the whole
      // reason this catch exists. A device that throws on stop is exactly the
      // one most likely to have left a track open.
      bytes = null;
    }
    await _release();

    if (_cancelled || bytes == null || bytes.isEmpty) return null;
    return VoiceRecording(
      bytes: bytes,
      mimeType: mimeType,
      duration: duration,
    );
  }

  /// Abandons the recording and releases the device.
  ///
  /// The audio is dropped. Safe when idle, and safe during the permission
  /// prompt — that is the window guarantee 3 exists for.
  Future<void> cancel() async {
    _cancelled = true;
    _stopTicker();
    if (_stage == _Stage.recording) {
      try {
        await _device.stop();
      } catch (_) {
        // Already stopping, or stopping badly. `_release` below is what
        // actually matters.
      }
    }
    await _release();
  }

  /// Releases the device permanently. Safe to call when idle, and safe to
  /// call twice.
  ///
  /// After this the recorder will not start again — a disposed [start]
  /// reports [VoiceErrorCode.recorderFailed] rather than silently doing
  /// nothing, so a caller holding a stale recorder finds out.
  Future<void> dispose() async {
    _cancelled = true;
    _stopTicker();
    if (_stage == _Stage.recording) {
      try {
        await _device.stop();
      } catch (_) {
        // As in `cancel`.
      }
    }
    await _release();
    _stage = _Stage.disposed;
  }

  /// The one funnel. See guarantee 1.
  Future<void> _release() async {
    _stopTicker();
    if (_stage != _Stage.disposed) _stage = _Stage.idle;
    try {
      await _device.release();
    } catch (_) {
      // A failed release is not something a customer can act on, and an
      // unhandled asynchronous error escaping into the host's zone is exactly
      // what this module is forbidden to produce. `voice.ts` swallows the
      // matching `AudioContext.close()` rejection for the same reason.
    }
  }

  /// Silences the meter and the clock, synchronously.
  ///
  /// Separate from [_release] because every path that releases the device
  /// first has to `await` it, and the ticker must not survive that await —
  /// see [stop].
  void _stopTicker() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _tick() async {
    if (_stage != _Stage.recording) return;
    _elapsed += _tickInterval;

    // Guarantee 2. A meter that throws reports silence and the recording
    // continues; it never propagates and never stops the capture.
    double level;
    try {
      level = await _device.level();
    } catch (_) {
      level = 0;
    }

    // Stopped while the level was being read. Firing now would move a meter
    // that is no longer on screen and, worse, would report a tick for a
    // recording that has already ended.
    if (_stage != _Stage.recording) return;
    _onTick?.call(_elapsed, _clampLevel(level));
  }

  /// Defends the UI from a device that returned nonsense.
  ///
  /// NaN first, because it compares false against every bound and would
  /// otherwise sail through a clamp and into a `Transform.scale`, which
  /// throws rather than drawing nothing.
  static double _clampLevel(double level) {
    if (level.isNaN) return 0;
    return level.clamp(0.0, 1.0).toDouble();
  }
}

/// A finished [VoiceRecording], as the pending attachment that carries it.
///
/// ── The whole of the hop, in one function ────────────────────────────────
///
/// A voice note becomes a message by becoming a draft — the same draft a
/// picked photo becomes — and this is the only place the two vocabularies
/// meet. `AttachmentDraftController.setDraft` then applies exactly the
/// refusals a picked file faces, so a note that is nameless or over 25 MiB
/// is refused in the same words, by the same code, as a photo.
///
/// [VoiceRecording.fileName] is never blank, so the name check cannot fire
/// from this path today. It is still the one that runs, because the check
/// belongs to the controller and duplicating "is this sendable" here is the
/// second derivation this package keeps getting bitten by.
///
/// No `size` is passed: unlike a picked file, whose platform declares a size
/// before anything is read, these bytes are already in memory and
/// `bytes.length` IS the truth.
PickedAttachment pickedFromVoice(VoiceRecording note) => PickedAttachment(
      fileName: note.fileName,
      mimeType: note.mimeType,
      bytes: note.bytes,
    );
