// The bundled chime, as a FILE — that `assets/chime.wav` exists, is shipped,
// and really is the sound this port is supposed to make.
//
// ── Why this suite exists at all ──────────────────────────────────────────
//
// Nothing else can catch what it catches. A missing asset, a truncated one, a
// file of silence, or a tone nobody ever listened to would all leave every
// other test in this package green: the chime's rules are asserted through a
// fake player (`chime_test.dart`), and the seam that makes those tests
// runnable in CI is exactly the seam that stops them hearing anything.
//
// It also cannot be a behavioural test. The honest failure this whole task
// started from — "the default player makes no sound on a phone" — is not
// assertable from a unit test at all: there is no audio device, no platform
// channel and nobody listening. So this asserts the two things that CAN be
// checked mechanically and that together make the silence impossible: the
// bytes are the reference chime, and the bytes are registered to ship.
//
// Read from disk with `dart:io`, NOT through `rootBundle`. In this package's
// own test run the package is the root application, and flutter_tools keys a
// root application's assets unprefixed (`asset.dart`: the `packages/<name>/`
// Uri is built only when `packageName != null`, "Asset from, and declared in
// $packageName"). So the key a HOST sees is not the key a test here would
// see, and reading the file directly asserts the artifact rather than the
// test runner's view of it.

import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/reference_chime.dart';

/// The committed asset, as raw bytes.
Uint8List _asset() => File('assets/chime.wav').readAsBytesSync();

/// The `data` chunk as signed 16-bit samples, skipping the 44-byte header.
Int16List _samples(Uint8List wav) {
  final ByteData view = ByteData.sublistView(wav, 44);
  final Int16List out = Int16List(view.lengthInBytes ~/ 2);
  for (int i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, Endian.little);
  }
  return out;
}

String _fourCC(Uint8List wav, int at) =>
    String.fromCharCodes(wav.sublist(at, at + 4));

/// Goertzel power at [frequency] over [samples] — how much of that tone is
/// present, without pulling in an FFT or a dependency to find out.
double _tonePower(Int16List samples, int from, int to, double frequency) {
  final double w = 2 * math.pi * frequency / kReferenceChimeSampleRate;
  final double coeff = 2 * math.cos(w);
  double sPrev = 0;
  double sPrev2 = 0;
  for (int i = from; i < to; i++) {
    final double s = samples[i] + coeff * sPrev - sPrev2;
    sPrev2 = sPrev;
    sPrev = s;
  }
  return sPrev * sPrev + sPrev2 * sPrev2 - coeff * sPrev * sPrev2;
}

int _at(double seconds) => (seconds * kReferenceChimeSampleRate).round();

void main() {
  group('the asset is there and is a playable WAVE file', () {
    test('exists', () {
      expect(File('assets/chime.wav').existsSync(), isTrue,
          reason: 'assets/chime.wav is missing — the default player would '
              'resolve an asset key that is not in the bundle, which is '
              'silence with no error');
    });

    test('is canonical 16-bit mono PCM at the declared rate', () {
      final Uint8List wav = _asset();
      final ByteData header = ByteData.sublistView(wav);

      expect(_fourCC(wav, 0), 'RIFF');
      expect(_fourCC(wav, 8), 'WAVE');
      expect(_fourCC(wav, 12), 'fmt ');
      expect(_fourCC(wav, 36), 'data');
      // 1 is linear PCM. Anything else means a codec, and every platform
      // would then need it — the reason this ships PCM at all.
      expect(header.getUint16(20, Endian.little), 1, reason: 'not linear PCM');
      expect(header.getUint16(22, Endian.little), kReferenceChimeChannels);
      expect(header.getUint32(24, Endian.little), kReferenceChimeSampleRate);
      expect(header.getUint16(34, Endian.little), 16);
      // The declared data length must match the bytes actually present, or
      // players disagree about where the sound ends.
      expect(header.getUint32(40, Endian.little), wav.length - 44);
    });

    test('is short enough to be a chime and long enough to be two notes', () {
      final double seconds = _samples(_asset()).length / kReferenceChimeSampleRate;
      expect(seconds, closeTo(kReferenceChimeSeconds, 0.005));
    });

    // 12 KB is the number quoted in `pubspec.yaml` and the README as what
    // this costs a host. If it stops being true, those stop being true.
    test('stays small enough to bundle without comment', () {
      expect(_asset().length, lessThan(16 * 1024));
    });
  });

  group('the asset is actually the reference chime', () {
    test('is not silence, and is not clipped', () {
      final Int16List samples = _samples(_asset());
      int peak = 0;
      for (final int s in samples) {
        if (s.abs() > peak) peak = s.abs();
      }
      // The bug this forbids is a placeholder: a valid, correctly-registered,
      // completely inaudible file passes every other check in this suite.
      expect(peak / 32767, greaterThan(0.1), reason: 'the asset is silent');
      expect(peak / 32767, lessThan(0.5), reason: 'louder than intended');
      expect(peak / 32767, closeTo(kReferenceChimePeak, 0.01));
    });

    // The rising fifth, asserted as sound rather than as bytes: the first
    // note must be 660 Hz and the second 990 Hz, which is what makes this a
    // chime and not a buzz.
    test('opens on 660 Hz', () {
      final Int16List samples = _samples(_asset());
      final int from = _at(0.02);
      final int to = _at(0.08);
      expect(
        _tonePower(samples, from, to, 660),
        greaterThan(10 * _tonePower(samples, from, to, 990)),
      );
    });

    test('rises to 990 Hz', () {
      final Int16List samples = _samples(_asset());
      final int from = _at(0.115);
      final int to = _at(0.175);
      expect(
        _tonePower(samples, from, to, 990),
        greaterThan(10 * _tonePower(samples, from, to, 660)),
      );
    });

    // `chime.ts`: "a note that starts and stops at full amplitude clicks at
    // both ends, and the click is the part people notice."
    test('fades out instead of cutting off', () {
      final Int16List samples = _samples(_asset());
      int peak = 0;
      for (final int s in samples) {
        if (s.abs() > peak) peak = s.abs();
      }
      final int tailFrom = samples.length - _at(0.005);
      int tailPeak = 0;
      for (int i = tailFrom; i < samples.length; i++) {
        if (samples[i].abs() > tailPeak) tailPeak = samples[i].abs();
      }
      expect(tailPeak, lessThan(peak ~/ 100));
    });

    // The committed file is regenerable: `reference_chime.dart` is the
    // source, this is the output, and anyone can rebuild it. A tolerance of
    // one least-significant bit rather than byte equality, because `sin` may
    // differ in its last place across platforms and a chime is not worth a
    // suite that fails on a different machine.
    test('matches the synthesis it was generated from', () {
      final Uint8List committed = _asset();
      final Uint8List fresh = synthesiseReferenceChime();
      expect(committed.length, fresh.length);
      final Int16List a = _samples(committed);
      final Int16List b = _samples(fresh);
      int worst = 0;
      for (int i = 0; i < a.length; i++) {
        final int d = (a[i] - b[i]).abs();
        if (d > worst) worst = d;
      }
      expect(worst, lessThanOrEqualTo(1));
    });
  });

  group('the asset is registered to ship', () {
    // Without this entry the file sits in the repo and reaches no host's
    // application bundle — the failure that looks exactly like a missing
    // asset at runtime and like nothing at all in this repo.
    test('pubspec.yaml lists it under flutter: assets:', () {
      final String pubspec = File('pubspec.yaml').readAsStringSync();
      final int flutterSection =
          pubspec.indexOf(RegExp(r'^flutter:', multiLine: true));
      expect(flutterSection, isNonNegative, reason: 'no flutter: section');
      expect(
        pubspec.substring(flutterSection),
        contains('- $kChimeAssetPath'),
      );
    });

    // The two halves of one string, written in two files that cannot see
    // each other: `pubspec.yaml` says which file ships, and `chime.dart` says
    // which key to ask the bundle for. Flutter inserts `packages/<name>/`
    // between them for a dependency package. Nothing but this test would
    // notice them drifting apart — the player would simply ask for a key
    // nothing answers to, which is silence with no error anywhere.
    test('the key the player asks for is the path the pubspec ships', () {
      final String pubspec = File('pubspec.yaml').readAsStringSync();
      final RegExpMatch? name =
          RegExp(r'^name:\s*(\S+)', multiLine: true).firstMatch(pubspec);
      expect(name, isNotNull, reason: 'pubspec has no name:');

      expect(kChimeAssetKey, 'packages/${name!.group(1)}/$kChimeAssetPath');
    });
  });
}
