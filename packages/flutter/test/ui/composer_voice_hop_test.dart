// The composer's half of the voice hop: pressing stop puts the note in the
// draft, and the draft then behaves like any other pending file.
//
// ── What this covers that voice_to_draft_test.dart cannot ────────────────
//
// That file proves `pickedFromVoice` + `setDraft` in isolation. This one
// proves the WIRING — that `Composer` actually makes the call, and that the
// microphone is absent when there is no draft to record into. Those are the
// two things that were missing while the voice module was complete and
// tested: `onVoiceRecorded` handed the note out to a host, and no host in
// this package took it, so every voice test was green while a recording had
// nowhere to go.

import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const AttachmentMetadata _uploaded = AttachmentMetadata(
  url: 'https://cdn.example.com/voice-message.wav',
  fileName: 'voice-message.wav',
  mimeType: 'audio/wav',
  size: 3,
  mediaType: 'AUDIO',
);

/// A device that hands back three bytes and nothing else. Nothing in this
/// file reaches a microphone or a `MethodChannel`.
class _FakeDevice implements VoiceDevice {
  _FakeDevice({this.audio});

  Uint8List? audio;

  @override
  String mimeType = 'audio/wav';

  @override
  Future<VoicePermission> requestPermission() async => VoicePermission.granted;

  @override
  Future<void> start() async {}

  @override
  Future<Uint8List?> stop() async => audio;

  @override
  Future<double> level() async => 0;

  @override
  Future<void> release() async {}
}

void _ignore(Object error, StackTrace stackTrace) {}

Uint8List _audio([int size = 3]) => Uint8List(size);

Finder get _mic => find.byKey(const Key('composer.voice'));
Finder get _send => find.widgetWithIcon(IconButton, Icons.send);

void main() {
  late List<PickedAttachment> uploadedFiles;
  late List<AttachmentMetadata> announced;
  late List<String> sentText;

  AttachmentDraftController draftController() => AttachmentDraftController(
        picker: () async => throw StateError('the picker must not run'),
        uploader: (PickedAttachment file) async {
          uploadedFiles.add(file);
          return _uploaded;
        },
        onError: _ignore,
      );

  setUp(() {
    uploadedFiles = <PickedAttachment>[];
    announced = <AttachmentMetadata>[];
    sentText = <String>[];
  });

  Widget host({
    required AttachmentDraftController? attachments,
    required VoiceCaptureController? voice,
  }) =>
      MaterialApp(
        home: Scaffold(
          body: Material(
            child: Composer(
              onSend: sentText.add,
              attachments: attachments,
              onSendAttachment: announced.add,
              fileUploads: true,
              voice: voice,
            ),
          ),
        ),
      );

  /// Presses the mic twice — start, then stop — letting each settle.
  Future<void> record(WidgetTester tester) async {
    await tester.tap(_mic);
    await tester.pumpAndSettle();
    await tester.tap(_mic);
    await tester.pumpAndSettle();
  }

  group('the microphone is offered only where a note can go', () {
    testWidgets('no mic without a voice controller', (
      WidgetTester tester,
    ) async {
      final AttachmentDraftController attachments = draftController();
      addTearDown(attachments.dispose);

      await tester.pumpWidget(host(attachments: attachments, voice: null));

      expect(_mic, findsNothing);
    });

    testWidgets('no mic without a draft controller, even with a device', (
      WidgetTester tester,
    ) async {
      final VoiceCaptureController voice =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      addTearDown(voice.dispose);

      await tester.pumpWidget(host(attachments: null, voice: voice));

      // A note reaches the wire by becoming a draft. A microphone beside no
      // uploader records into nothing, which is the shape this whole node
      // exists to stop producing.
      expect(_mic, findsNothing);
    });

    testWidgets('a mic when both are present', (WidgetTester tester) async {
      final AttachmentDraftController attachments = draftController();
      addTearDown(attachments.dispose);
      final VoiceCaptureController voice =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      addTearDown(voice.dispose);

      await tester.pumpWidget(host(attachments: attachments, voice: voice));

      expect(_mic, findsOneWidget);
    });
  });

  group('a finished recording becomes the draft', () {
    testWidgets('without the host having to complete the hop', (
      WidgetTester tester,
    ) async {
      final AttachmentDraftController attachments = draftController();
      addTearDown(attachments.dispose);
      final VoiceCaptureController voice = VoiceCaptureController(
        createDevice: () => _FakeDevice(audio: _audio()),
      );
      addTearDown(voice.dispose);
      await tester.pumpWidget(host(attachments: attachments, voice: voice));

      await record(tester);

      expect(attachments.hasDraft, isTrue);
      expect(attachments.draft?.fileName, 'voice-message.wav');
    });

    testWidgets('and shows in the draft bar like a picked file', (
      WidgetTester tester,
    ) async {
      final AttachmentDraftController attachments = draftController();
      addTearDown(attachments.dispose);
      final VoiceCaptureController voice = VoiceCaptureController(
        createDevice: () => _FakeDevice(audio: _audio()),
      );
      addTearDown(voice.dispose);
      await tester.pumpWidget(host(attachments: attachments, voice: voice));

      await record(tester);

      expect(find.text('voice-message.wav'), findsOneWidget);
    });

    testWidgets('and sends through the ordinary attachment path', (
      WidgetTester tester,
    ) async {
      final AttachmentDraftController attachments = draftController();
      addTearDown(attachments.dispose);
      final VoiceCaptureController voice = VoiceCaptureController(
        createDevice: () => _FakeDevice(audio: _audio()),
      );
      addTearDown(voice.dispose);
      await tester.pumpWidget(host(attachments: attachments, voice: voice));

      await record(tester);
      await tester.tap(_send);
      await tester.pumpAndSettle();

      // The whole point of routing through the draft: the upload, the
      // announcement and the send button's state are the SAME ones a photo
      // gets, rather than a private path where each has to be remembered
      // again.
      expect(uploadedFiles.single.fileName, 'voice-message.wav');
      expect(announced.single, equals(_uploaded));
      expect(sentText, isEmpty, reason: 'a note is not words');
    });

    testWidgets('an empty recording produces no draft at all', (
      WidgetTester tester,
    ) async {
      final AttachmentDraftController attachments = draftController();
      addTearDown(attachments.dispose);
      // `stop` resolving null is how a cancelled or silent capture reports
      // "there is nothing to send"; it must not become an empty attachment.
      final VoiceCaptureController voice =
          VoiceCaptureController(createDevice: _FakeDevice.new);
      addTearDown(voice.dispose);
      await tester.pumpWidget(host(attachments: attachments, voice: voice));

      await record(tester);

      expect(attachments.hasDraft, isFalse);
      expect(attachments.statusMessage, isNull);
    });

    testWidgets('an oversized note is refused in the composer, in words', (
      WidgetTester tester,
    ) async {
      final AttachmentDraftController attachments = draftController();
      addTearDown(attachments.dispose);
      final VoiceCaptureController voice = VoiceCaptureController(
        createDevice: () => _FakeDevice(audio: _audio(kMaxAttachmentBytes + 1)),
      );
      addTearDown(voice.dispose);
      await tester.pumpWidget(host(attachments: attachments, voice: voice));

      await record(tester);

      // The refusal reaches the SCREEN, not just the controller — the draft
      // bar is already listening, so the hop needed no error handling of its
      // own.
      expect(find.text(kAttachmentTooLargeMessage), findsOneWidget);
      expect(attachments.hasDraft, isFalse);
    });
  });
}
