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
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

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

PickedAttachment _photo() => PickedAttachment(
      fileName: 'camera.jpg',
      mimeType: 'image/jpeg',
      bytes: Uint8List(2048),
    );

const AttachmentMetadata _meta = AttachmentMetadata(
  url: 'https://cdn.example.com/receipt.pdf',
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  mediaType: 'DOCUMENT',
);

Finder _iconButton(String tooltip) => find.byWidgetPredicate(
      (Widget widget) => widget is IconButton && widget.tooltip == tooltip,
    );

void _ignore(Object error, StackTrace stackTrace) {}

Widget _host(Widget child) {
  return MaterialApp(home: Scaffold(body: Center(child: child)));
}

/// Records launches instead of reaching a platform channel — the same
/// `UrlLauncherPlatform.instance` seam `unavailable_view_test.dart` uses,
/// which is the plugin's own documented way to swap the platform out.
class _FakeUrlLauncher extends UrlLauncherPlatform {
  final List<String> launched = <String>[];
  final List<PreferredLaunchMode> modes = <PreferredLaunchMode>[];

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launched.add(url);
    modes.add(options.mode);
    return true;
  }
}

_FakeUrlLauncher _installFakeLauncher() {
  final _FakeUrlLauncher fake = _FakeUrlLauncher();
  final UrlLauncherPlatform original = UrlLauncherPlatform.instance;
  UrlLauncherPlatform.instance = fake;
  addTearDown(() => UrlLauncherPlatform.instance = original);
  return fake;
}

const AttachmentMetadata _clip = AttachmentMetadata(
  url: 'https://cdn.example.com/clip.mp4',
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  size: 1024 * 1024,
  mediaType: 'videos',
);

void main() {
  late List<PickedAttachment?> picks;
  late List<PickedAttachment?> cameraPicks;
  late List<PickedAttachment?> galleryPicks;
  late AttachmentDraftController controller;

  AttachmentDraftController build({
    Future<AttachmentMetadata> Function(PickedAttachment file)? uploader,
  }) {
    int next = 0;
    int nextCamera = 0;
    int nextGallery = 0;
    return AttachmentDraftController(
      picker: () async => next < picks.length ? picks[next++] : null,
      cameraPicker: () async =>
          nextCamera < cameraPicks.length ? cameraPicks[nextCamera++] : null,
      galleryPicker: () async => nextGallery < galleryPicks.length
          ? galleryPicks[nextGallery++]
          : null,
      uploader: uploader ?? (PickedAttachment file) async => _meta,
      onError: _ignore,
    );
  }

  setUp(() {
    picks = <PickedAttachment?>[_file()];
    cameraPicks = <PickedAttachment?>[_photo()];
    galleryPicks = <PickedAttachment?>[
      PickedAttachment(
        fileName: 'gallery.jpg',
        mimeType: 'image/jpeg',
        bytes: Uint8List(2048),
      )
    ];
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
      expect(_iconButton('Attach a file'), findsNothing);
      expect(find.byType(IconButton), findsNothing);
    });

    testWidgets('renders a usable paperclip when uploads are enabled',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(
        AttachmentAttachButton(controller: controller, enabled: true),
      ));

      expect(_iconButton('Attach a file'), findsOneWidget);
      expect(
        tester.widget<IconButton>(find.byType(IconButton)).onPressed,
        isNotNull,
      );
    });

    testWidgets('tapping it opens file and camera choices',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(
        AttachmentAttachButton(controller: controller, enabled: true),
      ));

      await tester.tap(_iconButton('Attach a file'));
      await tester.pumpAndSettle();

      expect(find.text('File'), findsOneWidget);
      expect(find.text('Camera'), findsOneWidget);
      expect(controller.hasDraft, isFalse);
    });

    testWidgets('picking file through it fills the draft',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(
        AttachmentAttachButton(controller: controller, enabled: true),
      ));

      await tester.tap(_iconButton('Attach a file'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('File'));
      await tester.pumpAndSettle();

      expect(controller.draft?.fileName, 'receipt.pdf');
    });

    test('pickFromCamera uses the camera picker', () async {
      controller.dispose();
      controller = AttachmentDraftController(
        picker: () async => _file(fileName: 'wrong-file.pdf'),
        cameraPicker: () async => _photo(),
        uploader: (PickedAttachment file) async => _meta,
        onError: _ignore,
      );

      await controller.pickFromCamera();

      expect(controller.draft?.fileName, 'camera.jpg');
    });

    test('pickFromGallery uses the gallery picker', () async {
      controller.dispose();
      controller = AttachmentDraftController(
        picker: () async => _file(fileName: 'wrong-file.pdf'),
        galleryPicker: () async => PickedAttachment(
          fileName: 'gallery.jpg',
          mimeType: 'image/jpeg',
          bytes: Uint8List(2048),
        ),
        uploader: (PickedAttachment file) async => _meta,
        onError: _ignore,
      );

      await controller.pickFromGallery();

      expect(controller.draft?.fileName, 'gallery.jpg');
    });

    testWidgets('image button fills the draft from the gallery',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(
        AttachmentImageButton(controller: controller, enabled: true),
      ));

      await tester.tap(_iconButton('Attach an image'));
      await tester.pump();

      expect(controller.draft?.fileName, 'gallery.jpg');
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

    testWidgets('the 50 MiB refusal is on screen, in words',
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
      expect(find.textContaining('50.0 MB'), findsOneWidget);
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
            .flagsCollection
            .isLiveRegion,
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

    testWidgets('an agent image filed under "images" still gets its thumbnail',
        (WidgetTester tester) async {
      // What the agent console sends: the S3 folder name, verbatim, on both
      // the history read and the socket frame. Only the customer's OWN
      // uploads pass through `normalizeMediaType` on the way in.
      await tester.pumpWidget(_host(const AttachmentBubble(
        attachment: AttachmentMetadata(
          url: 'https://cdn.example.com/photo.png',
          fileName: 'photo.png',
          mimeType: 'image/png',
          size: 2048,
          mediaType: 'images',
        ),
      )));

      expect(find.byType(Image), findsOneWidget);
    });

    testWidgets('an agent video filed under "videos" gets the video glyph',
        (WidgetTester tester) async {
      await tester.pumpWidget(_host(const AttachmentBubble(
        attachment: AttachmentMetadata(
          url: 'https://cdn.example.com/clip.mp4',
          fileName: 'clip.mp4',
          mimeType: 'video/mp4',
          size: 1024 * 1024,
          mediaType: 'videos',
        ),
      )));

      expect(find.byIcon(Icons.videocam_outlined), findsOneWidget);
      expect(find.byIcon(Icons.insert_drive_file_outlined), findsNothing);
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

  group('AttachmentBubble — opening a file row', () {
    testWidgets('tapping a video opens it outside the app',
        (WidgetTester tester) async {
      final _FakeUrlLauncher fake = _installFakeLauncher();
      await tester.pumpWidget(_host(const AttachmentBubble(attachment: _clip)));

      await tester.tap(find.text('clip.mp4'));

      // Inline playback is out of scope, so a received video is only
      // watchable if the platform's own player or browser gets the URL.
      // External, as the Privacy link does: an in-app web view has no
      // address bar to show whose server the file came from.
      expect(fake.launched, <String>['https://cdn.example.com/clip.mp4']);
      expect(fake.modes,
          <PreferredLaunchMode>[PreferredLaunchMode.externalApplication]);
    });

    testWidgets('a video row is a button named for what it opens',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final _FakeUrlLauncher fake = _installFakeLauncher();
      await tester.pumpWidget(_host(const AttachmentBubble(attachment: _clip)));

      final Finder row = find.bySemanticsLabel('Open video clip.mp4, 1.0 MB');
      expect(row, findsOneWidget);
      final SemanticsNode node = tester.getSemantics(row);
      expect(node, containsSemantics(isButton: true, hasTapAction: true));

      // The screen-reader activation, not only the finger, reaches the URL.
      node.owner!.performAction(node.id, SemanticsAction.tap);
      await tester.pump();
      expect(fake.launched, <String>['https://cdn.example.com/clip.mp4']);
      handle.dispose();
    });

    testWidgets('the row is thumb-sized without stretching the bubble',
        (WidgetTester tester) async {
      _installFakeLauncher();
      await tester.pumpWidget(_host(const AttachmentBubble(attachment: _clip)));

      // `_host` centres the bubble in a bounded 600-high screen, which is
      // the parent that would expose a row that grows to fill its height.
      final double height = tester.getSize(find.byType(InkWell)).height;
      expect(height, greaterThanOrEqualTo(44));
      expect(height, lessThan(60));
    });

    testWidgets('a document row opens too, and says plainly what it is',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final _FakeUrlLauncher fake = _installFakeLauncher();
      await tester.pumpWidget(_host(const AttachmentBubble(attachment: _meta)));

      expect(
        find.bySemanticsLabel('Open receipt.pdf, 2 KB'),
        findsOneWidget,
      );
      await tester.tap(find.text('receipt.pdf'));
      expect(fake.launched, <String>['https://cdn.example.com/receipt.pdf']);
      handle.dispose();
    });

    testWidgets('an unsafe URL is not offered as something to open',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final _FakeUrlLauncher fake = _installFakeLauncher();

      // `javascript:` is the obvious one. `data:` is the one that matters:
      // `safeImageUrl` accepts `data:image/…` as a PICTURE, but navigated to
      // it is a document, so opening goes through `safeLinkUrl` instead.
      for (final String url in <String>[
        'javascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
      ]) {
        await tester.pumpWidget(_host(AttachmentBubble(
          attachment: AttachmentMetadata(
            url: url,
            fileName: 'clip.mp4',
            mimeType: 'video/mp4',
            size: 1024 * 1024,
            mediaType: 'VIDEO',
          ),
        )));

        // Still named, still sized — the customer learns what was attached.
        expect(find.text('clip.mp4'), findsOneWidget);
        expect(find.byType(InkWell), findsNothing);
        expect(find.bySemanticsLabel(RegExp('^Open')), findsNothing);
        expect(
          tester.getSemantics(
              find.bySemanticsLabel('Attachment clip.mp4, 1.0 MB')),
          isNot(containsSemantics(hasTapAction: true)),
        );

        await tester.tap(find.text('clip.mp4'), warnIfMissed: false);
        expect(fake.launched, isEmpty);
      }
      handle.dispose();
    });

    testWidgets('an image thumbnail is not turned into a button',
        (WidgetTester tester) async {
      _installFakeLauncher();
      await tester.pumpWidget(_host(const AttachmentBubble(
        attachment: AttachmentMetadata(
          url: 'https://cdn.example.com/photo.png',
          fileName: 'photo.png',
          mimeType: 'image/png',
          size: 2048,
          mediaType: 'IMAGE',
        ),
      )));

      // Opening an image full-size is its own design question; this change
      // makes file rows openable and leaves the thumbnail as it was.
      expect(find.byType(InkWell), findsNothing);
    });
  });
}
