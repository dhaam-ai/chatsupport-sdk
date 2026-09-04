// The three widgets: the gated paperclip, the draft chip that carries the
// module's one sentence, and the transcript bubble that fills T9's seam.
//
// The gating test is the one to read first. `RemoteConfig.fileUploads` is
// read in exactly one place, and a merchant who turned uploads off gets no
// button rather than a disabled one — a disabled paperclip advertises a
// feature that was deliberately not offered.

import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

PickedAttachment _file({
  String fileName = 'receipt.pdf',
  int size = 2048,
}) {
  return PickedAttachment(
    fileName: fileName,
    mimeType: 'application/pdf',
    bytes: Uint8List(size),
  );
}

const AttachmentMetadata _meta = AttachmentMetadata(
  url: 'https://cdn.example.com/receipt.pdf',
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  mediaType: 'DOCUMENT',
);

void _ignore(Object error, StackTrace stackTrace) {}

Widget _host(Widget child) {
  return MaterialApp(home: Scaffold(body: Center(child: child)));
}

void main() {
  late List<PickedAttachment?> picks;
  late AttachmentDraftController controller;

  AttachmentDraftController build({
    Future<AttachmentMetadata> Function(PickedAttachment file)? uploader,
  }) {
    int next = 0;
    return AttachmentDraftController(
      picker: () async => next < picks.length ? picks[next++] : null,
      uploader: uploader ?? (PickedAttachment file) async => _meta,
      onError: _ignore,
    );
  }

  setUp(() {
    picks = <PickedAttachment?>[_file()];
    controller = build();
  });

  tearDown(() => controller.dispose());

  group('AttachmentAttachButton and RemoteConfig.fileUploads', () {
    testWidgets('renders nothing at all when uploads are disabled',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(
        AttachmentAttachButton(controller: controller, enabled: false),
      ));

      // Absent, not disabled. A greyed paperclip invites the customer to
      // work out why; an absent one says nothing, which is the truth.
      expect(find.byIcon(Icons.attach_file), findsNothing);
      expect(find.byType(IconButton), findsNothing);
    });

    testWidgets('renders a usable paperclip when uploads are enabled',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(
        AttachmentAttachButton(controller: controller, enabled: true),
      ));

      expect(find.byIcon(Icons.attach_file), findsOneWidget);
      expect(
        tester.widget<IconButton>(find.byType(IconButton)).onPressed,
        isNotNull,
      );
    });

    testWidgets('picking through it fills the draft',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(
        AttachmentAttachButton(controller: controller, enabled: true),
      ));

      await tester.tap(find.byIcon(Icons.attach_file));
      await tester.pumpAndSettle();

      expect(controller.draft?.fileName, 'receipt.pdf');
    });

    testWidgets('is disabled while the composer itself is',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(
        AttachmentAttachButton(
          controller: controller,
          enabled: true,
          composerEnabled: false,
        ),
      ));

      // The consent gate, or a closed session. `composer.ts`:
      // `attachButton.disabled = !enabled || uploading`.
      expect(
        tester.widget<IconButton>(find.byType(IconButton)).onPressed,
        isNull,
      );
    });
  });

  group('AttachmentDraftBar', () {
    testWidgets('renders nothing when there is no draft and nothing to say',
        (WidgetTester tester) async {
      await tester
          .pumpWidget(_host(AttachmentDraftBar(controller: controller)));

      expect(find.byType(Text), findsNothing);
    });

    testWidgets('shows the file name and its size once one is picked',
        (WidgetTester tester) async {
      await tester
          .pumpWidget(_host(AttachmentDraftBar(controller: controller)));

      await controller.pick();
      await tester.pump();

      expect(find.text('receipt.pdf'), findsOneWidget);
      expect(find.text('2 KB'), findsOneWidget);
    });

    testWidgets('the remove button drops the draft',
        (WidgetTester tester) async {
      await tester
          .pumpWidget(_host(AttachmentDraftBar(controller: controller)));
      await controller.pick();
      await tester.pump();

      await tester.tap(find.byIcon(Icons.close));
      await tester.pump();

      expect(controller.hasDraft, isFalse);
      expect(find.text('receipt.pdf'), findsNothing);
    });

    testWidgets('the 25 MiB refusal is on screen, in words',
        (WidgetTester tester) async {
      picks = <PickedAttachment?>[_file(size: kMaxAttachmentBytes + 1)];
      controller.dispose();
      controller = build();
      await tester
          .pumpWidget(_host(AttachmentDraftBar(controller: controller)));

      await controller.pick();
      await tester.pump();

      // Refused with words, not silence — and the sentence names the limit
      // so the customer knows what would have worked.
      expect(find.text(kAttachmentTooLargeMessage), findsOneWidget);
      expect(find.textContaining('25.0 MB'), findsOneWidget);
    });

    testWidgets('the refusal is a live region, so it is spoken too',
        (WidgetTester tester) async {
      picks = <PickedAttachment?>[_file(size: kMaxAttachmentBytes + 1)];
      controller.dispose();
      controller = build();
      await tester
          .pumpWidget(_host(AttachmentDraftBar(controller: controller)));

      await controller.pick();
      await tester.pump();

      // A refusal a screen reader never speaks is silent, which is the
      // failure mode this whole criterion exists to prevent.
      expect(
        tester
            .getSemantics(find.text(kAttachmentTooLargeMessage))
            .hasFlag(SemanticsFlag.isLiveRegion),
        isTrue,
      );
    });

    testWidgets('a failed upload leaves the chip AND says why',
        (WidgetTester tester) async {
      controller.dispose();
      controller = build(
        uploader: (PickedAttachment file) async => throw StateError('nope'),
      );
      await tester
          .pumpWidget(_host(AttachmentDraftBar(controller: controller)));

      await controller.pick();
      await controller.uploadDraft();
      await tester.pump();

      // Both halves matter: the sentence alone would leave the customer
      // hunting for the file again, and the chip alone would not say why
      // nothing happened.
      expect(find.text('receipt.pdf'), findsOneWidget);
      expect(find.text(kAttachmentUploadFailedMessage), findsOneWidget);
    });

    testWidgets('names the file for a screen reader without reading the row',
        (WidgetTester tester) async {
      await tester
          .pumpWidget(_host(AttachmentDraftBar(controller: controller)));
      await controller.pick();
      await tester.pump();

      expect(
        find.bySemanticsLabel('Attached receipt.pdf, 2 KB'),
        findsOneWidget,
      );
    });
  });

  group('AttachmentBubble — the fill for T9\'s attachmentBuilder seam', () {
    testWidgets('names a document and its size', (WidgetTester tester) async {
      await tester.pumpWidget(_host(buildAttachmentBubble(
        // A BuildContext is not needed by the builder, but the seam's type
        // demands one; the widget is what actually renders.
        tester.element(find.byType(Center)),
        _meta,
      )));

      expect(find.text('receipt.pdf'), findsOneWidget);
      expect(find.text('2 KB'), findsOneWidget);
    });

    testWidgets('draws a thumbnail for an image on an allowed scheme',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(const AttachmentBubble(
        attachment: AttachmentMetadata(
          url: 'https://cdn.example.com/photo.png',
          fileName: 'photo.png',
          mimeType: 'image/png',
          size: 2048,
          mediaType: 'IMAGE',
        ),
      )));

      expect(find.byType(Image), findsOneWidget);
    });

    testWidgets('falls back to the file row when safeImageUrl refuses the url',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(const AttachmentBubble(
        attachment: AttachmentMetadata(
          // The allowlist refuses anything that is not http(s) or a
          // `data:image/…` URI. A refused URL is not a broken image: the
          // customer still learns what was attached and how big it was.
          url: 'javascript:alert(1)',
          fileName: 'photo.png',
          mimeType: 'image/png',
          size: 2048,
          mediaType: 'IMAGE',
        ),
      )));

      expect(find.byType(Image), findsNothing);
      expect(find.text('photo.png'), findsOneWidget);
    });

    testWidgets('classifies by mediaType, not by mimeType',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(const AttachmentBubble(
        attachment: AttachmentMetadata(
          url: 'https://cdn.example.com/scan.png',
          fileName: 'scan.png',
          // An `image/*` mimeType the server nonetheless filed as a document.
          // Re-deriving "is this a picture" from the mimeType here would be a
          // second classifier that can disagree with the one the server used
          // when it decided where to put the bytes.
          mimeType: 'image/png',
          size: 2048,
          mediaType: 'DOCUMENT',
        ),
      )));

      expect(find.byType(Image), findsNothing);
      expect(find.byIcon(Icons.insert_drive_file_outlined), findsOneWidget);
    });

    testWidgets('gives a video its own glyph', (WidgetTester tester) async {
      await tester.pumpWidget(_host(const AttachmentBubble(
        attachment: AttachmentMetadata(
          url: 'https://cdn.example.com/clip.mp4',
          fileName: 'clip.mp4',
          mimeType: 'video/mp4',
          size: 1024 * 1024,
          mediaType: 'VIDEO',
        ),
      )));

      expect(find.byIcon(Icons.videocam_outlined), findsOneWidget);
      expect(find.text('1.0 MB'), findsOneWidget);
    });

    testWidgets('a thumbnail is not silent to a screen reader',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(const AttachmentBubble(
        attachment: AttachmentMetadata(
          url: 'https://cdn.example.com/photo.png',
          fileName: 'photo.png',
          mimeType: 'image/png',
          size: 2048,
          mediaType: 'IMAGE',
        ),
      )));

      // An image bubble has no text of its own at all, so without a composed
      // label the whole row is a hole in the transcript.
      //
      // This also pins the placeholder box. The image has not decoded a frame
      // here — it never will in a test — so without the reserved size the
      // bubble measures zero, Flutter drops the empty-rect semantics node,
      // and this label is absent for the whole of a slow load.
      expect(
        find.bySemanticsLabel('Attachment photo.png, 2 KB'),
        findsOneWidget,
      );
    });
  });
}
