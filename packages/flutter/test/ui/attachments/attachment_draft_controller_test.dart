// The pick → refuse → upload lifecycle.
//
// Every test here supplies both seams as closures. Nothing in this file
// touches a `MethodChannel`, a plugin or a socket — which is the point of the
// seams existing, and the assertion that matters most about this module's
// shape rather than its behaviour.
//
// The two cases worth reading first:
//
//  * `re-picking the same file` — the Dart counterpart of the sticky
//    `<input type="file">` value. It cannot happen by accident here, so the
//    test exists to stop it being written on purpose.
//  * `keeps the draft when the upload fails` — the one place this module
//    deliberately diverges from `composer.ts`, which clears the pending file
//    before awaiting the upload and strands the customer on a rejection.

import 'dart:async';
import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

PickedAttachment _file({
  String fileName = 'receipt.pdf',
  String mimeType = 'application/pdf',
  int size = 12,
}) {
  return PickedAttachment(
    fileName: fileName,
    mimeType: mimeType,
    bytes: Uint8List(size),
  );
}

const AttachmentMetadata _uploaded = AttachmentMetadata(
  url: 'https://cdn.example.com/receipt.pdf',
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  size: 12,
  mediaType: 'DOCUMENT',
);

/// Records what the controller sent to the host's error reporter.
class _Reports {
  final List<Object> errors = <Object>[];
  void call(Object error, StackTrace stackTrace) => errors.add(error);
}

void main() {
  late _Reports reports;
  late List<PickedAttachment> uploaded;

  setUp(() {
    reports = _Reports();
    uploaded = <PickedAttachment>[];
  });

  /// A controller whose picker returns [picks] in order, and whose uploader
  /// records every file it is handed.
  AttachmentDraftController controllerFor(
    List<PickedAttachment?> picks, {
    Future<AttachmentMetadata> Function(PickedAttachment file)? uploader,
  }) {
    int next = 0;
    return AttachmentDraftController(
      picker: () async => next < picks.length ? picks[next++] : null,
      uploader: uploader ??
          (PickedAttachment file) async {
            uploaded.add(file);
            return _uploaded;
          },
      onError: reports.call,
    );
  }

  group('pick', () {
    test('makes an acceptable file the draft', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[_file()]);
      addTearDown(controller.dispose);

      await controller.pick();

      expect(controller.hasDraft, isTrue);
      expect(controller.draft?.fileName, 'receipt.pdf');
      expect(controller.statusMessage, isNull);
    });

    test('notifies its listeners so the composer can redraw', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[_file()]);
      addTearDown(controller.dispose);
      int notifications = 0;
      controller.addListener(() => notifications++);

      await controller.pick();

      expect(notifications, 1);
    });

    test('says nothing when the customer backs out of the picker', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[null]);
      addTearDown(controller.dispose);

      await controller.pick();

      // A cancel is not a failure. A sentence here would tell someone who
      // changed their mind that something went wrong.
      expect(controller.statusMessage, isNull);
      expect(controller.hasDraft, isFalse);
      expect(reports.errors, isEmpty);
    });
  });

  group('the 25 MiB cap', () {
    test('refuses an oversized file with words, not silence', () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file(size: kMaxAttachmentBytes + 1)],
      );
      addTearDown(controller.dispose);

      await controller.pick();

      expect(controller.statusMessage, kAttachmentTooLargeMessage);
      expect(controller.statusMessage, contains('25.0 MB'));
      expect(controller.hasDraft, isFalse);
    });

    test('a file exactly at the cap is accepted', () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file(size: kMaxAttachmentBytes)],
      );
      addTearDown(controller.dispose);

      await controller.pick();

      expect(controller.hasDraft, isTrue);
      expect(controller.statusMessage, isNull);
    });

    test('never reaches the uploader with an oversized file', () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file(size: kMaxAttachmentBytes + 1)],
      );
      addTearDown(controller.dispose);

      await controller.pick();
      await controller.uploadDraft();

      // The cap is the client's — the adapter has none. A refusal that let
      // the bytes through would be no refusal at all.
      expect(uploaded, isEmpty);
    });

    test('an accepted file clears a previous refusal message', () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file(size: kMaxAttachmentBytes + 1), _file()],
      );
      addTearDown(controller.dispose);

      await controller.pick();
      expect(controller.statusMessage, kAttachmentTooLargeMessage);

      await controller.pick();

      // A stale "too large" sitting above a file that WAS accepted reads as
      // the accepted file having been refused too.
      expect(controller.statusMessage, isNull);
      expect(controller.hasDraft, isTrue);
    });
  });

  group("the empty-fileName check T7 assigned to this seam", () {
    test('refuses a nameless file with words', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[_file(fileName: '')]);
      addTearDown(controller.dispose);

      await controller.pick();

      expect(controller.statusMessage, kAttachmentUnnamedMessage);
      expect(controller.hasDraft, isFalse);
    });

    test('refuses a whitespace-only name too', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[_file(fileName: '   ')]);
      addTearDown(controller.dispose);

      await controller.pick();

      expect(controller.statusMessage, kAttachmentUnnamedMessage);
      expect(controller.hasDraft, isFalse);
    });

    test('never reaches uploadAttachment with a blank name', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[_file(fileName: '')]);
      addTearDown(controller.dispose);

      await controller.pick();
      await controller.uploadDraft();

      // T7 has no fallback for this on purpose: the route would echo the
      // empty name back, `AttachmentMetadata.fromJson` would refuse it, and
      // the message would vanish from the transcript on the next history
      // load — long after the customer watched it send.
      expect(uploaded, isEmpty);
    });

    test('is checked before the size, so the words name the real problem',
        () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[
          _file(fileName: '', size: kMaxAttachmentBytes + 1),
        ],
      );
      addTearDown(controller.dispose);

      await controller.pick();

      // Telling someone to shrink a file that would still be refused for its
      // name sends them off to do work that cannot help.
      expect(controller.statusMessage, kAttachmentUnnamedMessage);
    });
  });

  group('re-picking the SAME file', () {
    test('re-picking with no upload in between still fires', () async {
      final PickedAttachment same = _file();
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[same, same]);
      addTearDown(controller.dispose);
      int notifications = 0;
      controller.addListener(() => notifications++);

      await controller.pick();
      await controller.pick();

      // The draft is UNCHANGED across these two picks, which is exactly the
      // state an `identical(_draft, file)` or `_draft == file` guard would
      // short-circuit on. The web bug was a sticky `<input type="file">`
      // value making the second choice silent; this is the only shape it can
      // take in Dart, and it can only get here on purpose.
      expect(notifications, 2);
      expect(controller.draft, same);
    });

    test('re-picking after a failed upload fires again', () async {
      final PickedAttachment same = _file();
      int attempts = 0;
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[same, same],
        uploader: (PickedAttachment file) async {
          attempts++;
          throw StateError('flaky');
        },
      );
      addTearDown(controller.dispose);

      await controller.pick();
      await controller.uploadDraft();
      // The draft survived the failure, so it is still `same` — and this is
      // the case a customer actually hits: the send did not go through, so
      // they choose the very same file again.
      expect(controller.draft, same);

      await controller.pick();
      expect(controller.statusMessage, isNull,
          reason: 'an accepted re-pick clears the previous failure sentence');

      await controller.uploadDraft();
      expect(attempts, 2);
    });

    test('fires again for the identical instance across two sends', () async {
      final PickedAttachment same = _file();
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[same, same]);
      addTearDown(controller.dispose);

      await controller.pick();
      await controller.uploadDraft();
      await controller.pick();
      await controller.uploadDraft();

      // A customer sends a photo, the agent says it came through blurry, and
      // they pick the very same file again.
      expect(uploaded, hasLength(2));
      expect(uploaded[0], same);
      expect(uploaded[1], same);
    });

    test('fires again for a value-equal but distinct instance', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[_file(), _file()]);
      addTearDown(controller.dispose);

      await controller.pick();
      await controller.uploadDraft();
      await controller.pick();
      await controller.uploadDraft();

      // Guards against the second shape of the same mistake: giving
      // PickedAttachment value equality and then writing `if (_draft == file)
      // return`. It is deliberately left without one.
      expect(uploaded, hasLength(2));
    });

    test('replaces the draft rather than queueing a second one', () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[
          _file(fileName: 'first.pdf'),
          _file(fileName: 'second.pdf')
        ],
      );
      addTearDown(controller.dispose);

      await controller.pick();
      await controller.pick();

      // One composer, one pending file — `composer.ts`'s `setAttachment`
      // calls `clearAttachment()` first for the same reason.
      expect(controller.draft?.fileName, 'second.pdf');
    });
  });

  group('a picker that throws', () {
    test('shows a plain sentence and reports the exception', () async {
      final Object boom = StateError('MissingPluginException(pickFiles)');
      final AttachmentDraftController controller = AttachmentDraftController(
        picker: () async => throw boom,
        uploader: (PickedAttachment file) async => _uploaded,
        onError: reports.call,
      );
      addTearDown(controller.dispose);

      await controller.pick();

      expect(controller.statusMessage, kAttachmentPickFailedMessage);
      expect(controller.hasDraft, isFalse);
      // The exception carries a channel name and sometimes a path. It goes to
      // the host's reporter, never onto the customer's screen.
      expect(reports.errors, <Object>[boom]);
      expect(controller.statusMessage, isNot(contains('MissingPlugin')));
    });
  });

  group('uploadDraft', () {
    test('resolves the metadata and clears the draft on success', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[_file()]);
      addTearDown(controller.dispose);

      await controller.pick();
      final AttachmentMetadata? result = await controller.uploadDraft();

      expect(result, _uploaded);
      expect(controller.hasDraft, isFalse);
      expect(controller.statusMessage, isNull);
    });

    test('resolves null and stays silent when there is nothing to upload',
        () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[]);
      addTearDown(controller.dispose);

      expect(await controller.uploadDraft(), isNull);
      expect(controller.hasDraft, isFalse);
      expect(controller.statusMessage, isNull);
      expect(reports.errors, isEmpty);
    });

    test('hands the picked mimeType through verbatim, empty included',
        () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file(mimeType: '')],
      );
      addTearDown(controller.dispose);

      await controller.pick();
      await controller.uploadDraft();

      // T7 decided absent-vs-wrong at the endpoint. A `?? octet-stream`
      // written on this side turns a malformed type into a silent generic
      // file and defeats the distinction.
      expect(uploaded.single.mimeType, '');
    });
  });

  group('a failed upload', () {
    Future<AttachmentMetadata> alwaysFails(PickedAttachment file) async {
      throw StateError('RestTransportException(https://api.example.com)');
    }

    test('keeps the draft intact so the file need not be found again',
        () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file()],
        uploader: alwaysFails,
      );
      addTearDown(controller.dispose);

      await controller.pick();
      final AttachmentMetadata? result = await controller.uploadDraft();

      // `composer.ts` clears the pending file BEFORE awaiting the upload, so
      // a dropped packet costs the customer the file. Nothing queues an
      // upload — if the bytes did not land, this controller is the only
      // record of them.
      expect(result, isNull);
      expect(controller.hasDraft, isTrue);
      expect(controller.draft?.fileName, 'receipt.pdf');
    });

    test('surfaces a plain sentence and reports the exception', () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file()],
        uploader: alwaysFails,
      );
      addTearDown(controller.dispose);

      await controller.pick();
      await controller.uploadDraft();

      expect(controller.statusMessage, kAttachmentUploadFailedMessage);
      expect(reports.errors, hasLength(1));
      expect(controller.statusMessage, isNot(contains('api.example.com')));
    });

    test('re-enables the composer, so a retry is just pressing Send again',
        () async {
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file()],
        uploader: alwaysFails,
      );
      addTearDown(controller.dispose);

      await controller.pick();
      await controller.uploadDraft();

      // The `finally` is the whole reason this is not `_uploading = false`
      // after the await — same bug `FormSubmitController` exists to fix.
      expect(controller.isUploading, isFalse);
      expect(controller.canSend, isTrue);
    });

    test('a second Send retries the same file', () async {
      int attempts = 0;
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file()],
        uploader: (PickedAttachment file) async {
          attempts++;
          if (attempts == 1) throw StateError('flaky');
          return _uploaded;
        },
      );
      addTearDown(controller.dispose);

      await controller.pick();
      expect(await controller.uploadDraft(), isNull);
      expect(await controller.uploadDraft(), _uploaded);

      expect(attempts, 2);
      expect(controller.hasDraft, isFalse);
      expect(controller.statusMessage, isNull);
    });
  });

  group('an in-flight upload blocks send', () {
    test('canSend is false for the duration of the flight', () async {
      final Completer<AttachmentMetadata> gate =
          Completer<AttachmentMetadata>();
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file()],
        uploader: (PickedAttachment file) => gate.future,
      );
      addTearDown(controller.dispose);

      await controller.pick();
      expect(controller.canSend, isTrue);

      final Future<AttachmentMetadata?> flight = controller.uploadDraft();
      await pumpEventQueue();

      expect(controller.isUploading, isTrue);
      expect(controller.canSend, isFalse);

      gate.complete(_uploaded);
      await flight;

      expect(controller.canSend, isTrue);
    });

    test('a second uploadDraft during the flight starts no second upload',
        () async {
      final Completer<AttachmentMetadata> gate =
          Completer<AttachmentMetadata>();
      int attempts = 0;
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file()],
        uploader: (PickedAttachment file) {
          attempts++;
          return gate.future;
        },
      );
      addTearDown(controller.dispose);

      await controller.pick();
      final Future<AttachmentMetadata?> first = controller.uploadDraft();
      await pumpEventQueue();
      final AttachmentMetadata? second = await controller.uploadDraft();

      // A double-tapped Send would otherwise put the same file in the
      // bucket twice and announce it twice.
      expect(attempts, 1);
      expect(second, isNull);
      // Nothing failed, so nothing is said — telling the customer their
      // upload failed while it is still running is a lie about their file.
      expect(controller.statusMessage, isNull);

      gate.complete(_uploaded);
      await first;
    });

    test('a pick during the flight cannot swap the file out from under it',
        () async {
      final Completer<AttachmentMetadata> gate =
          Completer<AttachmentMetadata>();
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[
          _file(fileName: 'first.pdf'),
          _file(fileName: 'second.pdf')
        ],
        uploader: (PickedAttachment file) => gate.future,
      );
      addTearDown(controller.dispose);

      await controller.pick();
      final Future<AttachmentMetadata?> flight = controller.uploadDraft();
      await pumpEventQueue();

      await controller.pick();

      // The upload already holds `first.pdf`. Accepting `second.pdf` here
      // would announce the file the customer just replaced.
      expect(controller.draft?.fileName, 'first.pdf');

      gate.complete(_uploaded);
      await flight;
    });

    test('clearDraft is a no-op during the flight', () async {
      final Completer<AttachmentMetadata> gate =
          Completer<AttachmentMetadata>();
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file()],
        uploader: (PickedAttachment file) => gate.future,
      );
      addTearDown(controller.dispose);

      await controller.pick();
      final Future<AttachmentMetadata?> flight = controller.uploadDraft();
      await pumpEventQueue();

      controller.clearDraft();

      // Letting the chip vanish would leave the customer watching an
      // attachment they believe they removed arrive in the transcript.
      expect(controller.hasDraft, isTrue);

      gate.complete(_uploaded);
      await flight;
    });
  });

  group('clearDraft', () {
    test('drops the pending file', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[_file()]);
      addTearDown(controller.dispose);

      await controller.pick();
      controller.clearDraft();

      expect(controller.hasDraft, isFalse);
    });

    test('does not notify when there was nothing to clear', () async {
      final AttachmentDraftController controller =
          controllerFor(<PickedAttachment?>[]);
      addTearDown(controller.dispose);
      int notifications = 0;
      controller.addListener(() => notifications++);

      controller.clearDraft();

      expect(notifications, 0);
    });
  });

  group('disposal during a flight', () {
    test('the finally does not throw after the composer is gone', () async {
      final Completer<AttachmentMetadata> gate =
          Completer<AttachmentMetadata>();
      final AttachmentDraftController controller = controllerFor(
        <PickedAttachment?>[_file()],
        uploader: (PickedAttachment file) => gate.future,
      );

      await controller.pick();
      final Future<AttachmentMetadata?> flight = controller.uploadDraft();
      await pumpEventQueue();

      controller.dispose();
      gate.complete(_uploaded);

      // Without the `_disposed` guard the re-enable that makes this module
      // worth having would itself throw.
      await expectLater(flight, completion(_uploaded));
    });
  });
}
