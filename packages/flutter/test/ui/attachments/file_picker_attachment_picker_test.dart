// The adapter's decision logic, exercised without ever loading the plugin's
// platform channel.
//
// `PlatformFile` has a public constructor, so everything the adapter actually
// decides — refuse-before-reading, the bounded drain, which media type is
// declared — is ordinary testable Dart. The only line not covered here is
// `FilePicker.pickFiles` itself, which has no branches in it.

import 'dart:typed_data';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_test/flutter_test.dart';

/// The first eight bytes of a real PNG. Enough for `mime`'s magic-number
/// table to recognise one.
final Uint8List _pngHeader = Uint8List.fromList(
  <int>[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
);

Stream<List<int>> _streamOf(List<int> bytes, {int chunk = 4}) async* {
  for (int i = 0; i < bytes.length; i += chunk) {
    yield bytes.sublist(i, i + chunk > bytes.length ? bytes.length : i + chunk);
  }
}

void main() {
  group('a file already over the cap', () {
    test('is refused without its bytes ever being read', () async {
      bool streamTouched = false;
      final PlatformFile file = PlatformFile(
        name: 'holiday.mov',
        size: kMaxAttachmentBytes + 1,
        readStream: () async* {
          streamTouched = true;
          yield <int>[0];
        }(),
      );

      final PickedAttachment picked = await attachmentFromPlatformFile(file);

      // `withData: true` would have loaded a 2 GB video into memory before
      // anything could look at it. A cap that crashes instead of refusing is
      // not a cap.
      expect(streamTouched, isFalse);
      expect(picked.bytes, isEmpty);
    });

    test('still reports its real size, so the cap can refuse it', () async {
      final PlatformFile file = PlatformFile(
        name: 'holiday.mov',
        size: kMaxAttachmentBytes + 1,
        readStream: const Stream<List<int>>.empty(),
      );

      final PickedAttachment picked = await attachmentFromPlatformFile(file);

      // Without the declared size this would report a length of zero, sail
      // straight past `isTooLarge`, and upload nothing at all.
      expect(picked.size, kMaxAttachmentBytes + 1);
      expect(picked.isTooLarge, isTrue);
      expect(picked.displaySize, '25.0 MB');
    });

    test('is refused with words once it reaches the controller', () async {
      final AttachmentDraftController controller = AttachmentDraftController(
        picker: () => attachmentFromPlatformFile(PlatformFile(
          name: 'holiday.mov',
          size: kMaxAttachmentBytes + 1,
          readStream: const Stream<List<int>>.empty(),
        )),
        uploader: (PickedAttachment file) async =>
            throw StateError('must not be reached'),
        onError: (Object error, StackTrace stackTrace) {},
      );
      addTearDown(controller.dispose);

      await controller.pick();

      // The refusal and its wording stay the controller's. The adapter only
      // declines to load what the controller was always going to refuse, so
      // the outcome is identical either way.
      expect(controller.statusMessage, kAttachmentTooLargeMessage);
      expect(controller.hasDraft, isFalse);
    });
  });

  group('reading a file within the cap', () {
    test('drains the stream into bytes', () async {
      final PlatformFile file = PlatformFile(
        name: 'notes.txt',
        size: 10,
        readStream: _streamOf(<int>[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      );

      final PickedAttachment picked = await attachmentFromPlatformFile(file);

      expect(picked.bytes, <int>[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(picked.size, 10);
    });

    test('prefers bytes the platform already provided', () async {
      // Web populates `bytes` directly; there is no stream to drain.
      final PlatformFile file = PlatformFile(
        name: 'notes.txt',
        size: 3,
        bytes: Uint8List.fromList(<int>[7, 8, 9]),
      );

      final PickedAttachment picked = await attachmentFromPlatformFile(file);

      expect(picked.bytes, <int>[7, 8, 9]);
    });

    test('stops reading a file that under-reports its own size', () async {
      // `PlatformFile.size` is documented to default to 0 when the platform
      // could not determine it, so the declared size cannot be the only
      // guard — otherwise an under-reporting file is drained without limit.
      int yielded = 0;
      Stream<List<int>> endless() async* {
        while (true) {
          yielded += 1024 * 1024;
          yield List<int>.filled(1024 * 1024, 0);
        }
      }

      final PlatformFile file =
          PlatformFile(name: 'lying.bin', size: 0, readStream: endless());

      final PickedAttachment picked = await attachmentFromPlatformFile(file);

      expect(picked.isTooLarge, isTrue);
      // One chunk past the cap and no further — enough for the refusal to
      // fire, bounded enough not to be the crash it is guarding against.
      expect(yielded, lessThanOrEqualTo(kMaxAttachmentBytes + 1024 * 1024));
    });

    test('throws when there is neither a stream nor bytes', () async {
      final PlatformFile file = PlatformFile(name: 'ghost.txt', size: 4);

      // Not a documented `file_picker` path, so a genuine "should not
      // happen". The controller turns it into the pick-failed sentence like
      // any other picker failure rather than letting it escape.
      await expectLater(
        attachmentFromPlatformFile(file),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('the media type file_picker does not report', () {
    test('comes from the extension when the bytes say nothing', () async {
      final PlatformFile file = PlatformFile(
        name: 'invoice.pdf',
        size: 3,
        bytes: Uint8List.fromList(<int>[0, 0, 0]),
      );

      expect(
        (await attachmentFromPlatformFile(file)).mimeType,
        'application/pdf',
      );
    });

    test('comes from the bytes when there is no extension at all', () async {
      // The Android case this sniffing exists for: a camera roll photo handed
      // back as `IMG_1234`. Extension-only lookup finds nothing, and the
      // customer's photo would arrive as a generic file with no thumbnail.
      final PlatformFile file = PlatformFile(
        name: 'IMG_1234',
        size: _pngHeader.length,
        bytes: _pngHeader,
      );

      expect((await attachmentFromPlatformFile(file)).mimeType, 'image/png');
    });

    test('is the EMPTY STRING when nothing identifies the file', () async {
      final PlatformFile file = PlatformFile(
        name: 'mystery',
        size: 3,
        bytes: Uint8List.fromList(<int>[0, 0, 0]),
      );

      // Not `application/octet-stream`. T7 owns that substitution at the
      // endpoint, where absence and wrongness are still distinguishable;
      // writing the fallback here would collapse them at the one seam that
      // can still tell them apart.
      expect((await attachmentFromPlatformFile(file)).mimeType, '');
    });

    test('survives a file shorter than the magic-number window', () async {
      // `bytes.sublist(0, headerLength)` has to clamp — a one-byte file would
      // otherwise throw a RangeError inside the picker.
      final PlatformFile file = PlatformFile(
        name: 'tiny',
        size: 1,
        bytes: Uint8List.fromList(<int>[0x89]),
      );

      expect((await attachmentFromPlatformFile(file)).mimeType, '');
    });

    test('an over-cap file still gets its type from the extension', () async {
      final PlatformFile file = PlatformFile(
        name: 'holiday.mp4',
        size: kMaxAttachmentBytes + 1,
        readStream: const Stream<List<int>>.empty(),
      );

      expect((await attachmentFromPlatformFile(file)).mimeType, 'video/mp4');
    });
  });

  group('the file name', () {
    test('is carried through verbatim, never invented', () async {
      final PlatformFile file = PlatformFile(
        name: 'Receipt (2).pdf',
        size: 3,
        bytes: Uint8List.fromList(<int>[0, 0, 0]),
      );

      expect(
          (await attachmentFromPlatformFile(file)).fileName, 'Receipt (2).pdf');
    });

    test('an empty one is passed on for the controller to refuse', () async {
      // The adapter does not substitute `'upload'` — that was a browser
      // workaround, not a policy. The refusal and its sentence belong to the
      // controller, which is the only layer with somewhere to put words.
      final PlatformFile file = PlatformFile(
        name: '',
        size: 3,
        bytes: Uint8List.fromList(<int>[0, 0, 0]),
      );

      final PickedAttachment picked = await attachmentFromPlatformFile(file);

      expect(picked.fileName, isEmpty);
      expect(picked.isUnnamed, isTrue);
    });
  });
}
