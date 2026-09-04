import 'package:dhaam_chat_flutter/src/ui/voice/voice.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeDevice implements VoiceDevice {
  _FakeDevice({this.permission = VoicePermission.granted, this.audio});

  VoicePermission permission;
  Uint8List? audio;
  double nextLevel = 0;

  int builds = 0;
  int releases = 0;

  @override
  String mimeType = 'audio/webm';

  @override
  Future<VoicePermission> requestPermission() async => permission;

  @override
  Future<void> start() async {}

  @override
  Future<Uint8List?> stop() async => audio;

  @override
  Future<double> level() async => nextLevel;

  @override
  Future<void> release() async => releases++;
}

Widget _wrap(Widget child) => MaterialApp(
      home: Scaffold(body: Column(children: <Widget>[child])),
    );

Uint8List _audio() => Uint8List.fromList(<int>[1, 2, 3]);

void main() {
  group('VoiceCaptureController', () {
    test('the device is built lazily, on the first press', () async {
      int built = 0;
      final VoiceCaptureController controller = VoiceCaptureController(
        createDevice: () {
          built++;
          return _FakeDevice();
        },
      );

      expect(controller.isInitialised, isFalse);
      expect(built, 0, reason: 'a composer nobody records with opens nothing');

      await controller.toggle();

      expect(controller.isInitialised, isTrue);
      expect(built, 1);
      controller.dispose();
    });

    test('toggling twice records and then returns the note', () async {
      final _FakeDevice device = _FakeDevice(audio: _audio());
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: () => device);

      expect(await controller.toggle(), isNull);
      expect(controller.isRecording, isTrue);

      final VoiceRecording? note = await controller.toggle();

      expect(note?.bytes.length, 3);
      expect(controller.isRecording, isFalse);
      controller.dispose();
    });

    test('a refused start surfaces the error and does not record', () async {
      final _FakeDevice device =
          _FakeDevice(permission: VoicePermission.denied);
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: () => device);

      expect(await controller.toggle(), isNull);

      expect(controller.error?.code, VoiceErrorCode.permissionDenied);
      expect(controller.isRecording, isFalse);
      controller.dispose();
    });

    test('the next press clears the last refusal before trying again',
        () async {
      final _FakeDevice device =
          _FakeDevice(permission: VoicePermission.denied, audio: _audio());
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: () => device);

      await controller.toggle();
      expect(controller.error, isNotNull);

      device.permission = VoicePermission.granted;
      await controller.toggle();

      expect(controller.error, isNull,
          reason: 'a stale refusal under a live recording is worse than none');
      expect(controller.isRecording, isTrue);
      controller.dispose();
    });

    test('stopping resets the clock so the next take starts at zero', () async {
      final _FakeDevice device = _FakeDevice(audio: _audio());
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: () => device);

      await controller.toggle();
      await controller.toggle();

      expect(controller.elapsed, Duration.zero);
      expect(controller.level, 0);
      controller.dispose();
    });

    test('cancel releases the device and produces nothing', () async {
      final _FakeDevice device = _FakeDevice(audio: _audio());
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: () => device);
      await controller.toggle();

      await controller.cancel();

      expect(controller.isRecording, isFalse);
      expect(device.releases, greaterThan(0));
      controller.dispose();
    });

    test('disposing mid-recording still hands the microphone back', () async {
      final _FakeDevice device = _FakeDevice(audio: _audio());
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: () => device);
      await controller.toggle();
      expect(controller.isRecording, isTrue);

      controller.dispose();
      // `dispose` is fire-and-forget by design; let its release land.
      await Future<void>.delayed(Duration.zero);

      expect(device.releases, greaterThan(0),
          reason: 'a live track keeps the OS microphone indicator lit after '
              'the widget is gone');
    });

    test('a notify after disposal is swallowed, not thrown', () async {
      // `dispose` hands the recorder back asynchronously, so a state change
      // can still arrive afterwards. Without the `_disposed` guard the
      // notify that follows would throw on a disposed ChangeNotifier.
      final _FakeDevice device = _FakeDevice(audio: _audio());
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: () => device);
      await controller.toggle();
      controller.dispose();

      await expectLater(controller.cancel(), completes);
    });
  });

  group('VoiceRecordButton', () {
    testWidgets('no controller renders no button at all',
        (WidgetTester tester) async {
      await tester.pumpWidget(_wrap(const VoiceRecordButton(controller: null)));

      expect(find.byKey(const Key('composer.voice')), findsNothing);
      expect(find.byType(IconButton), findsNothing);
    });

    testWidgets('a controller renders the microphone',
        (WidgetTester tester) async {
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_wrap(VoiceRecordButton(controller: controller)));

      expect(find.byKey(const Key('composer.voice')), findsOneWidget);
      expect(find.byIcon(Icons.mic_none), findsOneWidget);
    });

    testWidgets('the label and the glyph both change while recording',
        (WidgetTester tester) async {
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      await tester.pumpWidget(_wrap(VoiceRecordButton(controller: controller)));

      IconButton button() => tester.widget<IconButton>(
            find.byKey(const Key('composer.voice')),
          );
      expect(button().tooltip, 'Record a voice message');

      await tester.tap(find.byKey(const Key('composer.voice')));
      await tester.pump();

      expect(button().tooltip, 'Stop recording');
      expect(find.byIcon(Icons.stop), findsOneWidget);
      controller.dispose();
    });

    testWidgets('a disabled composer disables the microphone',
        (WidgetTester tester) async {
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_wrap(
        VoiceRecordButton(controller: controller, enabled: false),
      ));

      final IconButton button = tester.widget<IconButton>(
        find.byKey(const Key('composer.voice')),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('a finished note reaches onRecorded exactly once',
        (WidgetTester tester) async {
      final _FakeDevice device = _FakeDevice(audio: _audio());
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: () => device);
      addTearDown(controller.dispose);
      final List<VoiceRecording> recorded = <VoiceRecording>[];

      await tester.pumpWidget(_wrap(VoiceRecordButton(
        controller: controller,
        onRecorded: recorded.add,
      )));

      await tester.tap(find.byKey(const Key('composer.voice')));
      await tester.pump();
      expect(recorded, isEmpty, reason: 'starting is not a recording');

      await tester.tap(find.byKey(const Key('composer.voice')));
      await tester.pump();

      expect(recorded, hasLength(1));
      expect(recorded.single.fileName, 'voice-message.webm');
    });

    testWidgets('a stop that produced nothing calls nobody',
        (WidgetTester tester) async {
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      addTearDown(controller.dispose);
      final List<VoiceRecording> recorded = <VoiceRecording>[];

      await tester.pumpWidget(_wrap(VoiceRecordButton(
        controller: controller,
        onRecorded: recorded.add,
      )));
      await tester.tap(find.byKey(const Key('composer.voice')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('composer.voice')));
      await tester.pump();

      expect(recorded, isEmpty);
    });
  });

  group('VoiceRecordingBar', () {
    testWidgets('renders nothing when idle and silent',
        (WidgetTester tester) async {
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      addTearDown(controller.dispose);

      await tester.pumpWidget(_wrap(VoiceRecordingBar(controller: controller)));

      expect(find.byKey(const Key('composer.voice.recording')), findsNothing);
      expect(find.byKey(const Key('composer.voice.error')), findsNothing);
    });

    testWidgets('shows the strip and the clock while recording',
        (WidgetTester tester) async {
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      await tester.pumpWidget(_wrap(VoiceRecordingBar(controller: controller)));

      await controller.toggle();
      await tester.pump();

      expect(find.byKey(const Key('composer.voice.recording')), findsOneWidget);
      expect(find.text('0:00'), findsOneWidget);
      controller.dispose();
    });

    testWidgets('shows a refusal, and its words come from the taxonomy',
        (WidgetTester tester) async {
      final VoiceCaptureController controller = VoiceCaptureController(
        createDevice: () => _FakeDevice(permission: VoicePermission.dismissed),
      );
      addTearDown(controller.dispose);
      await tester.pumpWidget(_wrap(VoiceRecordingBar(controller: controller)));

      await controller.toggle();
      await tester.pump();

      expect(find.byKey(const Key('composer.voice.error')), findsOneWidget);
      expect(
        find.text(voiceErrorMessage(VoiceErrorCode.permissionDismissed)),
        findsOneWidget,
      );
    });

    testWidgets('the recording strip is a live region, and names itself once',
        (WidgetTester tester) async {
      final VoiceCaptureController controller =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      await tester.pumpWidget(_wrap(VoiceRecordingBar(controller: controller)));

      await controller.toggle();
      await tester.pump();

      final Semantics semantics = tester.widget<Semantics>(
        find
            .descendant(
              of: find.byKey(const Key('composer.voice.recording')),
              matching: find.byType(Semantics),
            )
            .first,
      );
      // A live region because it reports the customer's OWN action, and
      // "recording started" is the only confirmation a non-sighted customer
      // gets that the microphone actually opened.
      expect(semantics.properties.liveRegion, isTrue);
      expect(semantics.properties.label, 'Recording voice message');
      // The clock and the meter are excluded: a meter announced on every
      // tick would talk over the customer twenty times a second.
      expect(semantics.excludeSemantics, isTrue);
      controller.dispose();
    });
  });

  group('formatRecordingDuration', () {
    test('matches the reference m:ss', () {
      expect(formatRecordingDuration(Duration.zero), '0:00');
      expect(formatRecordingDuration(const Duration(seconds: 7)), '0:07');
      expect(formatRecordingDuration(const Duration(seconds: 65)), '1:05');
      expect(formatRecordingDuration(const Duration(minutes: 12)), '12:00');
    });

    test('truncates rather than rounding, as the reference floors', () {
      expect(
          formatRecordingDuration(const Duration(milliseconds: 1950)), '0:01');
    });
  });
}
