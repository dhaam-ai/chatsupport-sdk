/// The chime waveform, synthesised — the source of truth for
/// `assets/chime.wav`.
///
/// ── Why the asset is generated and not "found" ───────────────────────────
///
/// `packages/widget/src/ui/chime.ts` does not ship a sound; it builds one out
/// of two WebAudio oscillators, and its comments say exactly what they are: a
/// rising fifth, sine rather than square because "a widget's chime is heard on
/// top of whatever the visitor is already doing, and a harmonically rich
/// waveform at the same loudness is the one people describe as harsh", with an
/// envelope rather than a constant because "a note that starts and stops at
/// full amplitude clicks at both ends, and the click is the part people
/// notice".
///
/// Flutter has no WebAudio counterpart, so the port bundles a file. Every
/// number below is read off that reference, and the file in `assets/` is this
/// function's output — which is what lets `chime_asset_test.dart` assert that
/// the committed bytes really are that chime, rather than assert that some
/// bytes exist.
///
/// The WAVE container is [wavFromPcm16], the writer `lib/src/ui/voice/wav.dart`
/// already ships for voice notes. One WAVE writer in this package, not two.
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart' show wavFromPcm16;

/// 22050 Hz, mono. Nyquist is 11025 Hz, comfortably above the 990 Hz top
/// note, and halving CD rate halves an asset every host of this library
/// carries. The whole file is under 12 KB at this rate.
const int kReferenceChimeSampleRate = 22050;
const int kReferenceChimeChannels = 1;

/// The rising fifth: `[[660, 0], [990, 0.09]]` in `chime.ts`, hertz and the
/// second the note starts at.
const List<(double, double)> kReferenceChimeNotes = <(double, double)>[
  (660.0, 0.0),
  (990.0, 0.09),
];

/// The envelope, in seconds from the note's own start. `chime.ts` schedules
/// `setValueAtTime(0.0001, at)`, `exponentialRampToValueAtTime(0.06, at+0.012)`,
/// `exponentialRampToValueAtTime(0.0001, at+0.16)` and `stop(at+0.18)`.
const double kReferenceChimeAttackEnd = 0.012;
const double kReferenceChimeDecayEnd = 0.16;
const double kReferenceChimeNoteStop = 0.18;
const double kReferenceChimeGainFloor = 0.0001;
const double kReferenceChimeGainPeak = 0.06;

/// Where the file's own peak is put, as a fraction of full scale — about
/// -12 dBFS.
///
/// NOT the reference's 0.06. That number is a WebAudio gain applied inside a
/// merchant's page, chosen to sit under whatever else that page is playing;
/// this file is handed whole to the platform player at its default volume, so
/// the level has to live somewhere and the asset is the one place it can live
/// without the widget and the file disagreeing. Twelve decibels of headroom
/// is the conventional room to leave a short interface sound that may be
/// mixed with other audio. The envelope SHAPE above is the reference's
/// exactly; only the absolute level is this port's.
const double kReferenceChimePeak = 0.25;

/// The whole sound, in seconds: the last note's start plus its own length.
const double kReferenceChimeSeconds =
    0.09 + kReferenceChimeNoteStop; // 0.27

/// One note's gain [t] seconds after it began, `0` once it has stopped.
///
/// WebAudio's `exponentialRampToValueAtTime` interpolates geometrically
/// between the previous scheduled value and the target, which is why the
/// floor is 0.0001 and not zero: a geometric ramp cannot reach or leave
/// silence.
double referenceChimeGain(double t) {
  if (t < 0 || t >= kReferenceChimeNoteStop) return 0;
  if (t < kReferenceChimeAttackEnd) {
    final double progress = t / kReferenceChimeAttackEnd;
    return kReferenceChimeGainFloor *
        math
            .pow(kReferenceChimeGainPeak / kReferenceChimeGainFloor, progress)
            .toDouble();
  }
  if (t < kReferenceChimeDecayEnd) {
    final double progress = (t - kReferenceChimeAttackEnd) /
        (kReferenceChimeDecayEnd - kReferenceChimeAttackEnd);
    return kReferenceChimeGainPeak *
        math
            .pow(kReferenceChimeGainFloor / kReferenceChimeGainPeak, progress)
            .toDouble();
  }
  // `chime.ts` schedules no further ramp between the decay's end and
  // `stop()`, so the gain holds at the floor — inaudible, and a graceful
  // ending rather than a cut.
  return kReferenceChimeGainFloor;
}

/// The complete WAVE file: header plus 16-bit little-endian mono samples.
Uint8List synthesiseReferenceChime() {
  final int frames =
      (kReferenceChimeSeconds * kReferenceChimeSampleRate).round();
  final Float64List raw = Float64List(frames);
  double peak = 0;

  for (int i = 0; i < frames; i++) {
    final double t = i / kReferenceChimeSampleRate;
    double sum = 0;
    for (final (double frequency, double start) in kReferenceChimeNotes) {
      final double local = t - start;
      if (local < 0 || local >= kReferenceChimeNoteStop) continue;
      // `oscillator.start(now + at)` begins the sine at phase zero, so the
      // argument is time since THIS note began, not since the file did.
      sum += referenceChimeGain(local) *
          math.sin(2 * math.pi * frequency * local);
    }
    raw[i] = sum;
    if (sum.abs() > peak) peak = sum.abs();
  }

  final double scale =
      peak == 0 ? 0 : (kReferenceChimePeak * 32767) / peak;
  final Uint8List pcm = Uint8List(frames * 2);
  final ByteData samples = ByteData.view(pcm.buffer);
  for (int i = 0; i < frames; i++) {
    samples.setInt16(
      i * 2,
      (raw[i] * scale).round().clamp(-32768, 32767).toInt(),
      Endian.little,
    );
  }

  return wavFromPcm16(
    pcm,
    sampleRate: kReferenceChimeSampleRate,
    numChannels: kReferenceChimeChannels,
  );
}
