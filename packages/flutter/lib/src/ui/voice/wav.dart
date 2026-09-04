/// Wrapping raw PCM in the 44-byte header that makes it a playable file.
///
/// ── Why this package muxes its own container ─────────────────────────────
///
/// `record`'s stream mode is the only capture path that works on all six
/// platforms this package builds for, and it is the only one that does not
/// need `dart:io` — the file path (`AudioRecorder.start(config, path:)`)
/// writes to disk on every IO platform, and reading the bytes back would
/// pull in an import that stops this package compiling for web (the same
/// import `attachment_draft.dart` names as the reason a picker reads bytes
/// at the seam).
///
/// But stream mode's portable encoder is `pcm16bits`, and raw PCM has no
/// header at all: it is a bare wall of samples with no record of its own
/// sample rate, channel count or bit depth. Uploaded as-is it is a file the
/// agent downloads and cannot play, in any player, ever — the sample rate
/// needed to interpret it exists only in the client that recorded it.
///
/// So the 44 bytes below are not a nicety. They are the difference between a
/// voice note and an unopenable blob, and they are the smallest possible
/// amount of work that makes the difference: a fixed-layout canonical WAVE
/// header, no encoding, no resampling, no third dependency.
///
/// ── Format reference ─────────────────────────────────────────────────────
///
/// Canonical WAVE (RIFF) layout — the 44-byte PCM form, which is the only
/// one this writes and the only one it needs:
/// http://soundfile.sapp.org/doc/WaveFormat/
///
/// Multi-byte fields are little-endian, which [ByteData]'s explicit
/// [Endian.little] states rather than inherits: [ByteData] defaults to
/// big-endian, so omitting it would silently produce a file whose declared
/// sample rate is astronomically wrong.
library;

import 'dart:typed_data';

/// Bytes per sample. `AudioEncoder.pcm16bits`, which is what this package
/// asks `record` for, and the only depth this writer claims to handle.
const int kWavBitsPerSample = 16;

/// The fixed size of the canonical PCM WAVE header, in bytes.
const int kWavHeaderBytes = 44;

/// Wraps [pcm] — raw little-endian 16-bit samples — in a WAVE header.
///
/// [sampleRate] and [numChannels] must be the ones the capture actually ran
/// at. Nothing here can check that: PCM carries no self-description, which
/// is the whole reason this function exists. Passing the wrong sample rate
/// produces a file that plays at the wrong speed rather than one that fails
/// to open, so the caller getting this right is load-bearing.
///
/// An empty [pcm] yields a valid, silent, zero-length file rather than
/// nothing at all. That case is not reached in practice — `VoiceRecorder`
/// treats empty bytes as "there is nothing to send" and never builds a
/// recording from them — but a header-only file is the correct answer to
/// "wrap no samples", and returning something malformed instead would put a
/// second, hidden emptiness check in a function that has no business making
/// that decision.
Uint8List wavFromPcm16(
  Uint8List pcm, {
  required int sampleRate,
  required int numChannels,
}) {
  const int bytesPerSample = kWavBitsPerSample ~/ 8;
  final int blockAlign = numChannels * bytesPerSample;
  final int byteRate = sampleRate * blockAlign;

  final Uint8List out = Uint8List(kWavHeaderBytes + pcm.length);
  final ByteData header = ByteData.view(out.buffer);

  // "RIFF"
  out.setRange(0, 4, const <int>[0x52, 0x49, 0x46, 0x46]);
  // Everything after this field: 36 + the data chunk.
  header.setUint32(4, 36 + pcm.length, Endian.little);
  // "WAVE"
  out.setRange(8, 12, const <int>[0x57, 0x41, 0x56, 0x45]);

  // "fmt " — note the trailing space; the chunk id is four bytes.
  out.setRange(12, 16, const <int>[0x66, 0x6D, 0x74, 0x20]);
  // Subchunk size: 16 for PCM.
  header.setUint32(16, 16, Endian.little);
  // Audio format: 1 for linear PCM. Anything else means a codec, and this
  // writer does not encode.
  header.setUint16(20, 1, Endian.little);
  header.setUint16(22, numChannels, Endian.little);
  header.setUint32(24, sampleRate, Endian.little);
  header.setUint32(28, byteRate, Endian.little);
  header.setUint16(32, blockAlign, Endian.little);
  header.setUint16(34, kWavBitsPerSample, Endian.little);

  // "data"
  out.setRange(36, 40, const <int>[0x64, 0x61, 0x74, 0x61]);
  header.setUint32(40, pcm.length, Endian.little);
  out.setRange(kWavHeaderBytes, out.length, pcm);

  return out;
}

/// How long [pcm] runs for, at the rate it was captured at.
///
/// Not used to drive the timer the customer watches — [VoiceRecorder] counts
/// its own ticks for that, so the label they saw and the length recorded
/// cannot disagree. This is here for a caller that has bytes and no clock.
Duration pcm16Duration(
  Uint8List pcm, {
  required int sampleRate,
  required int numChannels,
}) {
  final int blockAlign = numChannels * (kWavBitsPerSample ~/ 8);
  if (blockAlign == 0 || sampleRate == 0) return Duration.zero;
  final int frames = pcm.length ~/ blockAlign;
  return Duration(microseconds: (frames * 1000000) ~/ sampleRate);
}
