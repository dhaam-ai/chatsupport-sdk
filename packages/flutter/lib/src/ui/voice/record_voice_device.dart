/// The real [VoiceDevice], built on `record` 6.2.1.
///
/// The one file in this module that imports a plugin — the same rule
/// `file_picker_attachment_picker.dart` follows for the attachment seam, and
/// for the same reason: everything worth testing (the taxonomy, the release
/// discipline, the meter clamp, the cancel-while-prompting window) lives
/// above [VoiceDevice] in ordinary Dart, and one fake device proves it for
/// every adapter that will ever exist.
///
/// ── Why stream capture and not file capture ──────────────────────────────
///
/// `AudioRecorder` offers both, and the choice is forced rather than
/// preferred:
///
///  * `start(config, path:)` writes to a path — "Required on all IO
///    platforms" — so reading the bytes back needs `dart:io`, which stops
///    this package compiling for web. Nothing in `lib/` imports it today and
///    `attachment_draft.dart` names that boundary explicitly.
///  * `startStream(config)` hands back a `Stream<Uint8List>` with no file
///    anywhere, on every platform this package builds for.
///
/// The cost of the stream path is the encoder. `record`'s own parity matrix
/// gives `pcm16bits` on all six platforms and `aacLc` on only three (not web,
/// not Windows, not linux), so PCM is the only portable answer — and PCM has
/// no header, so this module writes the 44-byte WAVE one itself. See
/// `wav.dart` on why those bytes are the difference between a voice note and
/// a file the agent cannot open.
///
/// ── Why 16 kHz mono ─────────────────────────────────────────────────────
///
/// `RecordConfig`'s defaults are 44100 Hz stereo, which for uncompressed PCM
/// is 176 KB per second — a four-minute note would be 42 MB and would be
/// refused by the 25 MiB cap after the customer had recorded it. 16 kHz mono
/// is 32 KB/s, so the cap is roughly thirteen minutes, and 16 kHz is the
/// rate speech codecs target because it covers the whole intelligible band.
/// A voice note is speech; the stereo image of one microphone is nothing.
///
/// ── What this adapter does NOT do ────────────────────────────────────────
///
/// No policy. It does not decide when to release, does not run a clock, does
/// not retry, and does not classify anything it has not actually been told.
/// [VoiceRecorder] owns all of that. In particular it never logs — §14, and
/// this file has no `debugPrint` and no reporter, because everything it
/// could say came from a microphone or from a platform channel.
library;

import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:record/record.dart';

import 'voice_error.dart';
import 'voice_recorder.dart';
import 'wav.dart';

/// Samples per second this package captures at. See the library header.
const int kVoiceSampleRate = 16000;

/// One channel. A voice note is one person talking into one microphone.
const int kVoiceChannels = 1;

/// What [RecordVoiceDevice.stop] produces.
///
/// `audio/wav`, because that is what the WAVE header this module writes
/// makes the bytes. Named here rather than inline so `VoiceRecording`'s
/// extension rule and this string cannot drift apart.
const String kVoiceMimeType = 'audio/wav';

/// The gain applied to the linear amplitude before clamping, ported from
/// `voice.ts`'s `Math.min(1, Math.sqrt(sum / samples.length) * 2.5)`.
///
/// Without it a normal speaking voice — which sits well below full scale —
/// barely moves the meter, and a meter that never moves reads as a
/// microphone that is not picking anything up.
const double _kMeterGain = 2.5;

/// The quietest input the meter distinguishes from silence, in dBFS.
///
/// `record` reports `-160` for true digital silence, and `dBFS → linear` is
/// an exponential curve, so nothing below this contributes a visible pixel
/// anyway. Naming the floor keeps the arithmetic away from
/// `double.negativeInfinity`, which some platforms report instead and which
/// would otherwise reach `pow` and come back as zero by luck rather than by
/// decision.
const double _kSilenceDbfs = -60;

/// Captures a voice note through `record`.
///
/// One instance owns one `AudioRecorder`. Build it lazily — that is what
/// [VoiceDeviceFactory] is for — so a widget nobody records with never opens
/// an audio device.
class RecordVoiceDevice implements VoiceDevice {
  RecordVoiceDevice({AudioRecorder? recorder})
      : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;

  /// The chunks that have arrived so far, newest last.
  ///
  /// Held as a list of chunks rather than a growing buffer so no copy
  /// happens until [stop], which is the one moment the whole recording has
  /// to exist contiguously anyway.
  final List<Uint8List> _chunks = <Uint8List>[];

  StreamSubscription<Uint8List>? _subscription;

  @override
  String get mimeType => kVoiceMimeType;

  /// Asks the platform for the microphone, prompting if it will.
  ///
  /// ── Why this can never report `dismissed` ────────────────────────────
  ///
  /// `AudioRecorder.hasPermission({bool request = true})` returns a bare
  /// `Future<bool>`. A dismissed prompt and a permanent refusal are both
  /// `false` and the plugin offers nothing that separates them.
  ///
  /// [VoicePermission] states what to do about exactly this: "An adapter
  /// that genuinely cannot tell [VoicePermission.dismissed] from
  /// [VoicePermission.denied] must say [VoicePermission.denied], because
  /// that is the answer whose UI (send them to settings) is merely unhelpful
  /// rather than wrong." Reporting `dismissed` would offer a "Try again"
  /// that re-prompts — and on a platform that will not prompt again, that
  /// button does nothing at all, forever, which is the failure the
  /// distinction exists to prevent.
  ///
  /// So the distinction survives in the taxonomy for an adapter that CAN
  /// make it, and this one takes the safe half.
  @override
  Future<VoicePermission> requestPermission() async {
    final bool granted = await _recorder.hasPermission();
    return granted ? VoicePermission.granted : VoicePermission.denied;
  }

  @override
  Future<void> start() async {
    _chunks.clear();
    final Stream<Uint8List> stream = await _recorder.startStream(
      const RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: kVoiceSampleRate,
        numChannels: kVoiceChannels,
      ),
    );
    // `onError` swallows rather than propagating: an error delivered on this
    // stream after `start` has returned has no caller left to throw to, and
    // an unhandled asynchronous error escaping into the host's zone is what
    // this module is forbidden to produce. The recording ends up short or
    // empty, and `VoiceRecorder` already treats empty as "nothing to send".
    _subscription = stream.listen(
      _chunks.add,
      onError: (Object _) {},
      cancelOnError: false,
    );
  }

  /// Ends the capture and returns the finished WAVE file.
  ///
  /// Deliberately does NOT release — [VoiceRecorder] calls [release] itself,
  /// on this path and on every other, which is what makes "the microphone
  /// goes back" one rule in one place instead of five.
  @override
  Future<Uint8List?> stop() async {
    // Before `_recorder.stop()`, so the last chunks are already in hand: the
    // subscription is cancelled after, not before, or the tail of the
    // recording is dropped.
    await _recorder.stop();
    await _subscription?.cancel();
    _subscription = null;

    final Uint8List pcm = _joinChunks();
    _chunks.clear();
    if (pcm.isEmpty) return null;

    return wavFromPcm16(
      pcm,
      sampleRate: kVoiceSampleRate,
      numChannels: kVoiceChannels,
    );
  }

  /// The current input level, 0..1.
  ///
  /// `record` reports dBFS; `voice.ts` reports a linear RMS. `10^(dB/20)` is
  /// the conversion between them, so applying the reference's own `* 2.5`
  /// gain and `min(1, …)` clamp afterwards reproduces the same curve the web
  /// widget's meter draws rather than an arbitrary new one.
  ///
  /// Best-effort by contract: this may throw and [VoiceRecorder] swallows it,
  /// reports zero and keeps recording. A broken meter must never cost the
  /// customer their audio.
  @override
  Future<double> level() async {
    final Amplitude amplitude = await _recorder.getAmplitude();
    return levelFromDbfs(amplitude.current);
  }

  /// Hands the microphone back. Idempotent, and safe when idle.
  ///
  /// `cancel()` rather than `stop()`: this is the discard path, and cancel is
  /// what `record` documents as removing the blob rather than finishing it.
  /// Every call is wrapped, because [VoiceDevice.release] is invoked on paths
  /// where nothing was ever started — and because a failure to release is
  /// not something a customer can act on.
  @override
  Future<void> release() async {
    await _subscription?.cancel();
    _subscription = null;
    _chunks.clear();
    try {
      await _recorder.cancel();
    } catch (_) {
      // Nothing was recording, or the platform refused. `dispose` below is
      // what actually returns the device either way.
    }
    try {
      await _recorder.dispose();
    } catch (_) {
      // Already disposed. Idempotence is part of this method's contract.
    }
  }

  Uint8List _joinChunks() {
    if (_chunks.isEmpty) return Uint8List(0);
    if (_chunks.length == 1) return _chunks.first;
    int total = 0;
    for (final Uint8List chunk in _chunks) {
      total += chunk.length;
    }
    final Uint8List joined = Uint8List(total);
    int offset = 0;
    for (final Uint8List chunk in _chunks) {
      joined.setRange(offset, offset + chunk.length, chunk);
      offset += chunk.length;
    }
    return joined;
  }
}

/// Maps a dBFS reading to the 0..1 the meter draws.
///
/// Public and free-standing so it can be tested without a microphone — it is
/// the only arithmetic in this file, and the only part of it that can be
/// wrong in a way a person would notice.
///
/// Returns 0 for silence, for anything at or below [_kSilenceDbfs], and for
/// a NaN or infinite reading. Those last two are not hypothetical: a
/// platform with no signal at all can report `-infinity`, and
/// `pow(10, -infinity / 20)` is 0 only by arithmetic luck — saying so
/// explicitly is cheaper than relying on it.
double levelFromDbfs(double dbfs) {
  if (dbfs.isNaN || !dbfs.isFinite) return 0;
  if (dbfs <= _kSilenceDbfs) return 0;
  final double linear = math.pow(10, dbfs / 20).toDouble();
  final double scaled = linear * _kMeterGain;
  return scaled > 1 ? 1 : scaled;
}
