// The 44 bytes that turn raw PCM into a file an agent can open.
//
// `record`'s only stream encoder available on all six platforms is
// `pcm16bits`, and raw PCM carries no record of its own sample rate, channel
// count or bit depth — that information exists only in the client that
// recorded it. So this header is not decoration: without it the upload is a
// blob no player will open, in any application, ever.
//
// Which also makes it the one part of the voice adapter that can be checked
// without a microphone, and the one worth checking byte for byte. A wrong
// endianness here does not throw; it produces a file that claims a sample
// rate of 2.1 billion and plays as a click.

import 'dart:typed_data';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reads a little-endian unsigned 32-bit field, the way a player would.
int _u32(Uint8List bytes, int offset) =>
    ByteData.view(bytes.buffer).getUint32(offset, Endian.little);

int _u16(Uint8List bytes, int offset) =>
    ByteData.view(bytes.buffer).getUint16(offset, Endian.little);

String _ascii(Uint8List bytes, int offset, int length) =>
    String.fromCharCodes(bytes.sublist(offset, offset + length));

/// Four PCM frames of mono 16-bit audio.
Uint8List _pcm(int frames) => Uint8List(frames * 2);

void main() {
  group('the RIFF/WAVE chunk ids', () {
    test('are exactly the four ASCII tags a player looks for', () {
      final Uint8List wav = wavFromPcm16(
        _pcm(4),
        sampleRate: 16000,
        numChannels: 1,
      );

      expect(_ascii(wav, 0, 4), 'RIFF');
      expect(_ascii(wav, 8, 4), 'WAVE');
      // Four bytes, and the fourth is a SPACE. A three-character "fmt" is
      // the classic way to write a file every player rejects.
      expect(_ascii(wav, 12, 4), 'fmt ');
      expect(_ascii(wav, 36, 4), 'data');
    });
  });

  group('the fmt chunk describes the capture', () {
    test('carries the sample rate, channels and depth it was given', () {
      final Uint8List wav = wavFromPcm16(
        _pcm(4),
        sampleRate: 16000,
        numChannels: 1,
      );

      expect(_u32(wav, 16), 16, reason: 'PCM subchunk size');
      expect(_u16(wav, 20), 1, reason: 'audio format: 1 is linear PCM');
      expect(_u16(wav, 22), 1, reason: 'channels');
      expect(_u32(wav, 24), 16000, reason: 'sample rate');
      expect(_u16(wav, 34), 16, reason: 'bits per sample');
    });

    test('byte rate and block align are derived, not assumed', () {
      // The two fields a player uses to seek. Wrong here and the file plays
      // at the wrong speed rather than failing to open, which is the harder
      // bug to notice.
      final Uint8List wav = wavFromPcm16(
        _pcm(4),
        sampleRate: 44100,
        numChannels: 2,
      );

      expect(_u16(wav, 32), 4, reason: '2 channels x 2 bytes');
      expect(_u32(wav, 28), 44100 * 4, reason: 'sampleRate x blockAlign');
    });

    test('reads the rate it was given, not the one this package prefers', () {
      final Uint8List wav = wavFromPcm16(
        _pcm(4),
        sampleRate: 48000,
        numChannels: 2,
      );

      expect(_u32(wav, 24), 48000);
      expect(_u16(wav, 22), 2);
    });
  });

  group('the sizes', () {
    test('the RIFF size counts everything after its own field', () {
      final Uint8List wav = wavFromPcm16(
        _pcm(100),
        sampleRate: 16000,
        numChannels: 1,
      );

      expect(_u32(wav, 4), 36 + 200);
    });

    test('the data size is the payload alone', () {
      final Uint8List wav = wavFromPcm16(
        _pcm(100),
        sampleRate: 16000,
        numChannels: 1,
      );

      expect(_u32(wav, 40), 200);
    });

    test('the file is the header plus the samples and nothing else', () {
      final Uint8List wav = wavFromPcm16(
        _pcm(100),
        sampleRate: 16000,
        numChannels: 1,
      );

      expect(wav.length, kWavHeaderBytes + 200);
    });
  });

  group('the samples survive', () {
    test('every byte lands after the header, in order', () {
      final Uint8List pcm = Uint8List.fromList(<int>[1, 2, 3, 4, 5, 6]);

      final Uint8List wav = wavFromPcm16(
        pcm,
        sampleRate: 16000,
        numChannels: 1,
      );

      expect(wav.sublist(kWavHeaderBytes), orderedEquals(pcm));
    });

    test('no samples yields a valid, silent file rather than nothing', () {
      // Not reached in practice — `VoiceRecorder` treats empty bytes as
      // "nothing to send" — but a header-only file is the correct answer to
      // "wrap no samples", and a second emptiness check here would be a
      // decision this function has no business making.
      final Uint8List wav = wavFromPcm16(
        Uint8List(0),
        sampleRate: 16000,
        numChannels: 1,
      );

      expect(wav.length, kWavHeaderBytes);
      expect(_u32(wav, 40), 0);
      expect(_ascii(wav, 0, 4), 'RIFF');
    });
  });

  group('pcm16Duration', () {
    test('counts frames at the rate they were captured', () {
      // One second of 16 kHz mono 16-bit: 16000 frames x 2 bytes.
      expect(
        pcm16Duration(Uint8List(32000), sampleRate: 16000, numChannels: 1),
        const Duration(seconds: 1),
      );
    });

    test('halves for stereo, since a frame is two samples wide', () {
      expect(
        pcm16Duration(Uint8List(32000), sampleRate: 16000, numChannels: 2),
        const Duration(milliseconds: 500),
      );
    });

    test('a zero rate is zero, not a division crash', () {
      expect(
        pcm16Duration(Uint8List(32000), sampleRate: 0, numChannels: 1),
        Duration.zero,
      );
    });
  });
}
