// Attachments, end to end: the paperclip is OFFERED on the real conversation
// screen, and what it uploads reaches `sendMessage`.
//
// ── Why this file exists beside composer_attachment_hop_test.dart ─────────
//
// That file proves the Composer's half — three submit guards, the upload
// inside submit, the draft surviving a failure — by constructing a
// `Composer` directly and handing it a controller. Every one of its tests
// passed while a customer could not attach a file at all, because
// `conversation_screen.dart` built its `Composer` with no controller and no
// `onSendAttachment`, and `WidgetChatClient.sendMessage` had no `attachment`
// parameter for the metadata to travel in.
//
// So the assertions here are deliberately about the two things that file
// cannot see: that the affordance RENDERS on the screen a customer actually
// meets, and that the metadata lands on the client rather than in a callback.
// The first test is the one that would have caught the gap — it looks for the
// button, not for a callback firing when invoked directly.

import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import '../state/fake_widget_chat_client.dart';
import '../support/remote_config_fixtures.dart';

/// See conversation_screen_test.dart's own copy for why this is
/// `runAsync` + `pump` and not `Future.delayed`.
Future<void> flush(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  await tester.pump();
}

const AttachmentMetadata _photo = AttachmentMetadata(
  url: 'https://cdn.example.com/cat.png',
  fileName: 'cat.png',
  mimeType: 'image/png',
  size: 2048,
  mediaType: 'IMAGE',
);

const AttachmentMetadata _doc = AttachmentMetadata(
  url: 'https://cdn.example.com/receipt.pdf',
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  mediaType: 'DOCUMENT',
);

PickedAttachment _picked({
  String fileName = 'cat.png',
  String mimeType = 'image/png',
  int size = 2048,
}) =>
    PickedAttachment(
      fileName: fileName,
      mimeType: mimeType,
      bytes: Uint8List(size),
    );

Widget _wrap(ChatWidgetCubit cubit) => BlocProvider<ChatWidgetCubit>.value(
      value: cubit,
      child: const MaterialApp(home: Scaffold(body: ConversationScreen())),
    );

Finder get _paperclip => find.widgetWithIcon(IconButton, Icons.attach_file);
Finder get _send => find.widgetWithIcon(IconButton, Icons.send);
Finder get _box => find.byKey(const Key('composer.message'));

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;
  late List<PickedAttachment> uploadRequests;

  /// A cubit wired the way a host with a REST client wires one.
  ///
  /// The picker is a closure, so nothing here reaches `file_picker` or a
  /// `MethodChannel` — which is the whole reason that seam is a parameter
  /// rather than a hardcoded call.
  ChatWidgetCubit build({
    AttachmentUploader? uploader,
    PickedAttachment? picks,
    bool cancels = false,
    bool fileUploads = true,
  }) {
    return ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(fileUploads: fileUploads),
      // A closure, so nothing here reaches `file_picker` or a
      // `MethodChannel`. `cancels` is a separate flag rather than a nullable
      // `picks` because resolving null IS a real case — the customer backing
      // out of the system picker — and one parameter cannot say both "the
      // test did not choose a file" and "the picker answered nothing".
      attachmentPicker: () async => cancels ? null : (picks ?? _picked()),
      attachmentUploader: uploader ??
          (PickedAttachment picked) async {
            uploadRequests.add(picked);
            return _photo;
          },
    );
  }

  setUp(() {
    client = FakeWidgetChatClient();
    uploadRequests = <PickedAttachment>[];
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  /// Taps the paperclip and lets the (fake) picker resolve.
  Future<void> attach(WidgetTester tester) async {
    await tester.tap(_paperclip);
    await flush(tester);
  }

  group('the affordance a customer meets', () {
    testWidgets('the conversation screen offers a paperclip', (
      WidgetTester tester,
    ) async {
      cubit = build();
      await tester.pumpWidget(_wrap(cubit));

      // The gap D23 named, in one assertion: this was absent for the whole
      // of T12's and T13's existence, so every attachment test in the
      // package was green while the feature did not exist for a user.
      expect(_paperclip, findsOneWidget);
    });

    testWidgets('no paperclip when the merchant turned uploads off', (
      WidgetTester tester,
    ) async {
      cubit = build(fileUploads: false);
      await tester.pumpWidget(_wrap(cubit));

      expect(_paperclip, findsNothing);
    });

    testWidgets('no paperclip when the host wired no uploader', (
      WidgetTester tester,
    ) async {
      // Off, not broken. A button that opened a picker and then had nowhere
      // to send the bytes would let a customer choose a file and watch it
      // fail for a feature that was never wired.
      cubit = ChatWidgetCubit(
        client: client,
        initialConfig: testRemoteConfig(),
      );
      await tester.pumpWidget(_wrap(cubit));

      expect(_paperclip, findsNothing);
    });

    testWidgets('a picked file shows in the draft bar', (
      WidgetTester tester,
    ) async {
      cubit = build();
      await tester.pumpWidget(_wrap(cubit));

      await attach(tester);

      expect(find.text('cat.png'), findsOneWidget);
    });
  });

  group('what reaches the wire', () {
    testWidgets('an uploaded attachment reaches sendMessage', (
      WidgetTester tester,
    ) async {
      cubit = build();
      await tester.pumpWidget(_wrap(cubit));

      await attach(tester);
      await tester.tap(_send);
      await flush(tester);

      // The whole chain in four assertions: the picker's file reached the
      // uploader, and the uploader's metadata reached the client.
      expect(uploadRequests.single.fileName, 'cat.png');
      expect(client.sentAttachment.single, equals(_photo));
    });

    testWidgets('the URL is the content and the media type is the type', (
      WidgetTester tester,
    ) async {
      cubit = build();
      await tester.pumpWidget(_wrap(cubit));

      await attach(tester);
      await tester.tap(_send);
      await flush(tester);

      // §12.10's shape. `visibleContent` is the other half of this contract
      // — it suppresses the placeholder by comparing `content` against
      // `attachment.url` — so a send that put anything else here would draw
      // a bubble with a raw URL in it.
      expect(client.sentContent.single, 'https://cdn.example.com/cat.png');
      expect(client.sentType.single, MessageType.image);
    });

    testWidgets('a DOCUMENT becomes a FILE message, not a TEXT one', (
      WidgetTester tester,
    ) async {
      cubit = build(
        uploader: (PickedAttachment picked) async => _doc,
      );
      await tester.pumpWidget(_wrap(cubit));

      await attach(tester);
      await tester.tap(_send);
      await flush(tester);

      expect(client.sentType.single, MessageType.file);
    });

    testWidgets('a file with a caption is TWO messages, file first', (
      WidgetTester tester,
    ) async {
      cubit = build();
      await tester.pumpWidget(_wrap(cubit));

      await attach(tester);
      await tester.enterText(_box, 'here you go');
      await tester.pump();
      await tester.tap(_send);
      await flush(tester);

      // `composer.ts` sends them in this order — `onSendAttachment(file)`,
      // then `onSend(text)` — and §12.10 is why they cannot be one: the URL
      // travels AS the content, so there is no field left for the caption.
      expect(client.sentContent, <String>[
        'https://cdn.example.com/cat.png',
        'here you go',
      ]);
      expect(client.sentAttachment, <AttachmentMetadata?>[_photo, null]);
      expect(client.sentType, <MessageType>[
        MessageType.image,
        MessageType.text,
      ]);
    });

    testWidgets('a plain message still carries no attachment', (
      WidgetTester tester,
    ) async {
      cubit = build();
      await tester.pumpWidget(_wrap(cubit));

      await tester.enterText(_box, 'just words');
      await tester.pump();
      await tester.tap(_send);
      await flush(tester);

      expect(client.sentContent.single, 'just words');
      expect(client.sentAttachment.single, isNull);
      expect(client.sentType.single, MessageType.text);
      expect(uploadRequests, isEmpty);
    });
  });

  group('the refusals travel to the screen', () {
    testWidgets('an oversized file is refused in words and never uploaded', (
      WidgetTester tester,
    ) async {
      cubit = build(picks: _picked(size: kMaxAttachmentBytes + 1));
      await tester.pumpWidget(_wrap(cubit));

      await attach(tester);

      expect(find.text(kAttachmentTooLargeMessage), findsOneWidget);
      expect(uploadRequests, isEmpty);
      expect(client.sentContent, isEmpty);
    });

    testWidgets('backing out of the picker says nothing', (
      WidgetTester tester,
    ) async {
      cubit = build(cancels: true);
      await tester.pumpWidget(_wrap(cubit));

      await attach(tester);

      expect(find.text(kAttachmentTooLargeMessage), findsNothing);
      expect(find.text(kAttachmentUnnamedMessage), findsNothing);
    });
  });
}
