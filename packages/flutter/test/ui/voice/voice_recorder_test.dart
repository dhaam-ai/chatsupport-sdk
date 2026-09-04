import 'dart:async';

import 'package:dhaam_chat_flutter/src/ui/voice/voice.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// A device that records what was asked of it and can be made to fail on any
/// one call.
///
/// The point of the whole module's shape: every rule [VoiceRecorder]
/// guarantees is asserted through this one fake, so no future adapter has to
/// re-prove any of them.
class _FakeDevice implements VoiceDevice {
  _FakeDevice({
    this.permission = VoicePermission.granted,
    this.audio,
    this.mimeType = 'audio/webm',
  });

  VoicePermission permission;
  Uint8List? audio;

  @override
  String mimeType;

  Object? failPermission;
  Object? failStart;
  Object? failStop;
  Object? failLevel;
  Object? failRelease;

  double nextLevel = 0;

  int starts = 0;
  int stops = 0;
  int releases = 0;
  int levelReads = 0;

  /// Held open to suspend [requestPermission], which is how the
  /// cancel-while-the-prompt-is-up window is reproduced.
  Completer<void>? prompt;

  @override
  Future<VoicePermission> requestPermission() async {
    final Completer<void>? gate = prompt;
    if (gate != null) await gate.future;
    final Object? failure = failPermission;
    if (failure != null) throw failure;
    return permission;
  }

  @override
  Future<void> start() async {
    starts++;
    final Object? failure = failStart;
    if (failure != null) throw failure;
  }

  @override
  Future<Uint8List?> stop() async {
    stops++;
    final Object? failure = failStop;
    if (failure != null) throw failure;
    return audio;
  }

  @override
  Future<double> level() async {
    levelReads++;
    final Object? failure = failLevel;
    if (failure != null) throw failure;
    return nextLevel;
  }

  @override
  Future<void> release() async {
    releases++;
    final Object? failure = failRelease;
    if (failure != null) throw failure;
  }
}

Uint8List _bytes(int length) => Uint8List.fromList(List<int>.filled(length, 7));

void main() {
  group('VoiceRecording.fileName', () {
    VoiceRecording named(String mimeType) => VoiceRecording(
          bytes: _bytes(1),
          mimeType: mimeType,
          duration: Duration.zero,
        );

    test('webm keeps the reference extension, not mime\'s "weba"', () {
      expect(named('audio/webm').fileName, 'voice-message.webm');
    });

    test('mp4 becomes m4a, codecs parameter and all', () {
      expect(
        named('audio/mp4;codecs=mp4a.40.2').fileName,
        'voice-message.m4a',
      );
    });

    test('the match is case-insensitive', () {
      expect(named('AUDIO/MP4').fileName, 'voice-message.m4a');
    });
  });

  group('start', () {
    test('a granted permission starts the device and records', () async {
      final _FakeDevice device = _FakeDevice();
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      expect(await recorder.start(), isNull);

      expect(recorder.isRecording, isTrue);
      expect(device.starts, 1);
      await recorder.dispose();
    });

    test('a denied permission reports permissionDenied and cannot retry',
        () async {
      final _FakeDevice device =
          _FakeDevice(permission: VoicePermission.denied);
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      final VoiceError? error = await recorder.start();

      expect(error?.code, VoiceErrorCode.permissionDenied);
      expect(error?.canRetry, isFalse);
      expect(recorder.isRecording, isFalse);
      expect(device.starts, 0, reason: 'the device must never be opened');
      await recorder.dispose();
    });

    test('a dismissed permission is a DIFFERENT code, and is retryable',
        () async {
      final _FakeDevice device =
          _FakeDevice(permission: VoicePermission.dismissed);
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      final VoiceError? error = await recorder.start();

      expect(error?.code, VoiceErrorCode.permissionDismissed);
      expect(error?.canRetry, isTrue,
          reason: 'this is the whole reason the two codes are separate');
      expect(
          error?.message,
          isNot(voiceErrorMessage(
            VoiceErrorCode.permissionDenied,
          )));
      await recorder.dispose();
    });

    test('a missing plugin is reported as unsupported, not as a crash',
        () async {
      final _FakeDevice device = _FakeDevice()
        ..failPermission = MissingPluginException('no impl');
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      expect((await recorder.start())?.code, VoiceErrorCode.unsupported);
      await recorder.dispose();
    });

    test('a device that refuses to open reports recorderFailed', () async {
      final _FakeDevice device = _FakeDevice()..failStart = StateError('busy');
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      expect((await recorder.start())?.code, VoiceErrorCode.recorderFailed);
      expect(recorder.isRecording, isFalse);
      await recorder.dispose();
    });

    test('an adapter that knows its platform keeps its own code', () async {
      final _FakeDevice device = _FakeDevice()
        ..failStart = const VoiceDeviceException(VoiceErrorCode.microphoneBusy);
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      final VoiceError? error = await recorder.start();

      expect(error?.code, VoiceErrorCode.microphoneBusy);
      expect(error?.canRetry, isTrue);
      await recorder.dispose();
    });

    test('a second start while recording is a no-op, not a restart', () async {
      final _FakeDevice device = _FakeDevice();
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      await recorder.start();
      expect(await recorder.start(), isNull);

      expect(device.starts, 1);
      await recorder.dispose();
    });

    test('starting a disposed recorder fails rather than silently idling',
        () async {
      final _FakeDevice device = _FakeDevice();
      final VoiceRecorder recorder = VoiceRecorder(device: device);
      await recorder.dispose();

      expect((await recorder.start())?.code, VoiceErrorCode.recorderFailed);
      expect(device.starts, 0);
    });

    test('cancelling while the permission prompt is up opens no microphone',
        () async {
      final _FakeDevice device = _FakeDevice();
      final Completer<void> prompt = Completer<void>();
      device.prompt = prompt;
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      final Future<VoiceError?> starting = recorder.start();
      await recorder.cancel();
      prompt.complete();

      expect(await starting, isNull,
          reason: 'a cancel is not a failure and has nothing to say');
      expect(device.starts, 0);
      expect(recorder.isRecording, isFalse);
      await recorder.dispose();
    });
  });

  group('stop', () {
    test('returns the audio, the mime type and the elapsed duration', () async {
      final _FakeDevice device = _FakeDevice(
        audio: _bytes(4),
        mimeType: 'audio/mp4',
      );
      final VoiceRecorder recorder = VoiceRecorder(device: device);
      await recorder.start();

      final VoiceRecording? recording = await recorder.stop();

      expect(recording?.bytes.length, 4);
      expect(recording?.mimeType, 'audio/mp4');
      expect(recording?.fileName, 'voice-message.m4a');
      expect(recording?.duration, Duration.zero);
      await recorder.dispose();
    });

    test('no audio is null rather than an empty recording', () async {
      final _FakeDevice device = _FakeDevice(audio: Uint8List(0));
      final VoiceRecorder recorder = VoiceRecorder(device: device);
      await recorder.start();

      expect(await recorder.stop(), isNull);
      await recorder.dispose();
    });

    test('stopping when nothing was started is null', () async {
      final _FakeDevice device = _FakeDevice();
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      expect(await recorder.stop(), isNull);
      await recorder.dispose();
    });

    test('a device that throws on stop yields null, not an exception',
        () async {
      final _FakeDevice device = _FakeDevice(audio: _bytes(4))
        ..failStop = StateError('boom');
      final VoiceRecorder recorder = VoiceRecorder(device: device);
      await recorder.start();

      expect(await recorder.stop(), isNull);
      await recorder.dispose();
    });
  });

  group('every exit path releases the device', () {
    test('stop', () async {
      final _FakeDevice device = _FakeDevice(audio: _bytes(2));
      final VoiceRecorder recorder = VoiceRecorder(device: device);
      await recorder.start();
      final int before = device.releases;

      await recorder.stop();

      expect(device.releases, greaterThan(before));
    });

    test('cancel', () async {
      final _FakeDevice device = _FakeDevice(audio: _bytes(2));
      final VoiceRecorder recorder = VoiceRecorder(device: device);
      await recorder.start();
      final int before = device.releases;

      await recorder.cancel();

      expect(device.releases, greaterThan(before));
      expect(recorder.isRecording, isFalse);
    });

    test('dispose', () async {
      final _FakeDevice device = _FakeDevice(audio: _bytes(2));
      final VoiceRecorder recorder = VoiceRecorder(device: device);
      await recorder.start();
      final int before = device.releases;

      await recorder.dispose();

      expect(device.releases, greaterThan(before));
    });

    test('a failure inside start', () async {
      final _FakeDevice device = _FakeDevice()..failStart = StateError('no');
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      await recorder.start();

      expect(device.releases, greaterThan(0));
    });

    test('a refused permission, where nothing was ever opened', () async {
      final _FakeDevice device =
          _FakeDevice(permission: VoicePermission.denied);
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      await recorder.start();

      expect(device.releases, greaterThan(0));
    });

    test('a device that throws on stop still gets released', () async {
      final _FakeDevice device = _FakeDevice()..failStop = StateError('boom');
      final VoiceRecorder recorder = VoiceRecorder(device: device);
      await recorder.start();
      final int before = device.releases;

      await recorder.stop();

      expect(device.releases, greaterThan(before),
          reason: 'this is the path most likely to leave a track open');
    });

    test('a release that itself throws is swallowed', () async {
      final _FakeDevice device = _FakeDevice()..failRelease = StateError('x');
      final VoiceRecorder recorder = VoiceRecorder(device: device);

      await recorder.start();
      await expectLater(recorder.dispose(), completes);
    });
  });

  group('the level meter is best-effort', () {
    testWidgets('a meter that throws does not stop the recording',
        (WidgetTester tester) async {
      final _FakeDevice device = _FakeDevice()..failLevel = StateError('no');
      final List<double> levels = <double>[];
      final VoiceRecorder recorder = VoiceRecorder(
        device: device,
        tickInterval: const Duration(milliseconds: 50),
        onTick: (Duration _, double level) => levels.add(level),
      );

      await recorder.start();
      await tester.pump(const Duration(milliseconds: 120));

      expect(recorder.isRecording, isTrue,
          reason: 'a broken meter must never cost the customer their audio');
      expect(levels, isNotEmpty);
      expect(levels.every((double level) => level == 0), isTrue);
      await recorder.dispose();
    });

    testWidgets('levels are clamped, and NaN is reported as silence',
        (WidgetTester tester) async {
      final _FakeDevice device = _FakeDevice()..nextLevel = 4.2;
      final List<double> levels = <double>[];
      final VoiceRecorder recorder = VoiceRecorder(
        device: device,
        tickInterval: const Duration(milliseconds: 50),
        onTick: (Duration _, double level) => levels.add(level),
      );

      await recorder.start();
      await tester.pump(const Duration(milliseconds: 60));
      device.nextLevel = double.nan;
      await tester.pump(const Duration(milliseconds: 60));

      expect(levels.first, 1.0);
      expect(levels.last, 0.0);
      await recorder.dispose();
    });

    testWidgets('elapsed advances with the ticks and stops with the recording',
        (WidgetTester tester) async {
      final _FakeDevice device = _FakeDevice(audio: _bytes(2));
      final VoiceRecorder recorder = VoiceRecorder(
        device: device,
        tickInterval: const Duration(milliseconds: 50),
      );

      await recorder.start();
      await tester.pump(const Duration(milliseconds: 150));
      final Duration whileRecording = recorder.elapsed;

      final VoiceRecording? recording = await recorder.stop();
      await tester.pump(const Duration(milliseconds: 200));

      expect(whileRecording, greaterThan(Duration.zero));
      expect(recording?.duration, whileRecording,
          reason: 'the label the customer watched and the length recorded '
              'are the same number');
      expect(device.levelReads, greaterThan(0));
      await recorder.dispose();
    });

    testWidgets('no tick fires after the recording has stopped',
        (WidgetTester tester) async {
      final _FakeDevice device = _FakeDevice(audio: _bytes(2));
      int ticks = 0;
      final VoiceRecorder recorder = VoiceRecorder(
        device: device,
        tickInterval: const Duration(milliseconds: 50),
        onTick: (Duration _, double __) => ticks++,
      );

      await recorder.start();
      await tester.pump(const Duration(milliseconds: 120));
      await recorder.stop();
      final int settled = ticks;
      await tester.pump(const Duration(milliseconds: 500));

      expect(ticks, settled);
      await recorder.dispose();
    });
  });
}
