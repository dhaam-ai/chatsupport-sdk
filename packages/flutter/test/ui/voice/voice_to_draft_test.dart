// The hop that makes the microphone useful: a finished recording becomes the
// pending attachment, subject to exactly the refusals a picked file faces.
//
// ── Why the refusal tests are the point of this file ──────────────────────
//
// `AttachmentDraftController.setDraft` exists so a note can enter the draft
// without a picker, and the whole risk of adding it was that the second
// entrance might not be guarded like the first. A four-minute recording
// really does approach the 25 MiB cap, so "the cap applies to voice too" is a
// claim about a case that happens rather than a hypothetical.
//
// Nothing here touches a microphone. `VoiceDevice` is the seam and these
// tests fill it with a fake, which is the entire reason that seam exists —
// see `voice_recorder.dart`'s header on why the seam is the DEVICE and not
// the recorder.

import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

const AttachmentMetadata _uploaded = AttachmentMetadata(
  url: 'https://cdn.example.com/voice-message.wav',
  fileName: 'voice-message.wav',
  mimeType: 'audio/wav',
  size: 64,
  mediaType: 'AUDIO',
);

VoiceRecording _note({
  String mimeType = 'audio/wav',
  int size = 64,
}) =>
    VoiceRecording(
      bytes: Uint8List(size),
      mimeType: mimeType,
      duration: const Duration(seconds: 2),
    );

void _ignore(Object error, StackTrace stackTrace) {}

void main() {
  late List<PickedAttachment> uploaded;

  AttachmentDraftController controller() => AttachmentDraftController(
        // A note never comes through the picker, so this one must never be
        // called. A test that reached it would be testing the wrong path.
        picker: () async => throw StateError('the picker must not run'),
        uploader: (PickedAttachment file) async {
          uploaded.add(file);
          return _uploaded;
        },
        onError: _ignore,
      );

  setUp(() => uploaded = <PickedAttachment>[]);

  group('pickedFromVoice', () {
    test('names the file from the recording, not from a guess', () {
      final PickedAttachment picked = pickedFromVoice(_note());

      expect(picked.fileName, 'voice-message.wav');
      expect(picked.mimeType, 'audio/wav');
    });

    test('reports the real byte count', () {
      // No declared size is passed, because unlike a picked file these bytes
      // are already in memory and their length IS the truth.
      expect(pickedFromVoice(_note(size: 4096)).size, 4096);
    });

    group('the extension names the container the bytes are actually in', () {
      test('wav, which is what this package records', () {
        expect(_note().fileName, 'voice-message.wav');
      });

      test('m4a for mp4, the reference rule kept', () {
        expect(_note(mimeType: 'audio/mp4').fileName, 'voice-message.m4a');
      });

      test('webm remains the fallback the browser adapter needs', () {
        expect(
          _note(mimeType: 'audio/webm;codecs=opus').fileName,
          'voice-message.webm',
        );
      });
    });
  });

  group('a recorded note becomes a draft', () {
    test('and is then an ordinary pending attachment', () {
      final AttachmentDraftController draft = controller();
      addTearDown(draft.dispose);

      draft.setDraft(pickedFromVoice(_note()));

      expect(draft.hasDraft, isTrue);
      expect(draft.draft?.fileName, 'voice-message.wav');
      expect(draft.statusMessage, isNull);
    });

    test('and reaches the uploader on send, like any other file', () async {
      final AttachmentDraftController draft = controller();
      addTearDown(draft.dispose);

      draft.setDraft(pickedFromVoice(_note()));
      final AttachmentMetadata? sent = await draft.uploadDraft();

      expect(uploaded.single.fileName, 'voice-message.wav');
      expect(sent, equals(_uploaded));
      expect(draft.hasDraft, isFalse);
    });
  });

  group('the same refusals as a picked file', () {
    test('an oversized note is refused in the SAME words', () {
      final AttachmentDraftController draft = controller();
      addTearDown(draft.dispose);

      // Uncompressed PCM at 16 kHz mono is ~32 KB a second, so this is a
      // recording of about thirteen minutes — long, and reachable by someone
      // who forgot they were recording.
      draft.setDraft(pickedFromVoice(_note(size: kMaxAttachmentBytes + 1)));

      expect(draft.statusMessage, kAttachmentTooLargeMessage);
      expect(draft.hasDraft, isFalse);
    });

    test('and is never uploaded', () async {
      final AttachmentDraftController draft = controller();
      addTearDown(draft.dispose);

      draft.setDraft(pickedFromVoice(_note(size: kMaxAttachmentBytes + 1)));
      await draft.uploadDraft();

      expect(uploaded, isEmpty);
    });

    test('a note exactly at the cap is accepted', () {
      final AttachmentDraftController draft = controller();
      addTearDown(draft.dispose);

      draft.setDraft(pickedFromVoice(_note(size: kMaxAttachmentBytes)));

      expect(draft.hasDraft, isTrue);
    });
  });

  group('the meter mapping', () {
    test('full scale saturates rather than overflowing the bar', () {
      // 0 dBFS is linear 1.0, and the reference multiplies by 2.5 before
      // clamping — so anything loud pins the meter, which is what the web
      // widget's own meter does.
      expect(levelFromDbfs(0), 1.0);
    });

    test('a normal speaking level moves the meter visibly', () {
      // -20 dBFS is linear 0.1; x2.5 is 0.25. Without the reference's gain
      // this would be a quarter of the height and a meter that reads as a
      // microphone picking nothing up.
      expect(levelFromDbfs(-20), closeTo(0.25, 1e-9));
    });

    test('silence is zero', () {
      expect(levelFromDbfs(-60), 0);
      expect(levelFromDbfs(-160), 0);
    });

    test('a platform reporting -infinity is zero, by decision', () {
      // Some platforms report this for true digital silence. `pow` would
      // answer 0 here anyway; saying so explicitly is cheaper than relying
      // on arithmetic luck at a boundary.
      expect(levelFromDbfs(double.negativeInfinity), 0);
      expect(levelFromDbfs(double.nan), 0);
    });

    test('never exceeds one, whatever the platform claims', () {
      // A positive dBFS reading is meaningless — the scale tops out at 0 —
      // but a clipping input can produce one, and `Transform.scale` past 1
      // draws a bar out of its own box.
      expect(levelFromDbfs(12), 1.0);
    });
  });
}
