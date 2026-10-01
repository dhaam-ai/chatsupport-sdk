// The hop that makes attachments reachable: T12 built the paperclip, the
// draft bar and the draft controller, and until now nothing outside that
// module referred to any of them — a customer could not attach a file at all.
//
// The two tests to read first are in "the three submit guards": an in-flight
// upload must BLOCK a send, and a failed upload must keep BOTH the draft and
// the words the customer typed. Everything else here is the wiring that makes
// those two true.
//
// ── What the mutation check found, recorded rather than hidden ────────────
//
// Deleting `if (attachments.hasDraft) return;` fails the failed-upload test.
// Deleting `file = await attachments.uploadDraft();` fails five tests.
// Deleting `if (!attachments.canSend) return;` fails NOTHING, and that is a
// fact about the controller rather than a gap in these tests:
// `AttachmentDraftController` clears `_draft` and `_uploading` in the same
// synchronous block, so `canSend == false` always implies `hasDraft == true`
// and the third guard catches everything the first would. The first guard is
// kept because it is the one that actually runs, and because it keeps the
// composer's refusal independent of the controller's internal re-entrancy
// handling — but no test here claims to pin it, and writing one would mean
// faking a controller state the real controller cannot reach.

import 'dart:async';
import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const AttachmentMetadata _uploaded = AttachmentMetadata(
  url: 'https://cdn.example.com/receipt.pdf',
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  mediaType: 'DOCUMENT',
);

PickedAttachment _file() => PickedAttachment(
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      bytes: Uint8List(2048),
    );

void _ignore(Object error, StackTrace stackTrace) {}

Widget _host(Widget child) =>
    MaterialApp(home: Scaffold(body: Material(child: child)));

Finder get _sendButton => find.widgetWithIcon(IconButton, Icons.send);
Finder get _messageBox => find.byKey(const Key('composer.message'));

bool _sendEnabled(WidgetTester tester) =>
    tester.widget<IconButton>(_sendButton).onPressed != null;

void main() {
  late AttachmentDraftController attachments;
  late List<String> sent;
  late List<AttachmentMetadata> announced;

  /// A controller whose picker always yields one file and whose uploader is
  /// supplied per test.
  AttachmentDraftController build({
    Future<AttachmentMetadata> Function(PickedAttachment file)? uploader,
  }) =>
      AttachmentDraftController(
        picker: () async => _file(),
        uploader: uploader ?? (PickedAttachment _) async => _uploaded,
        onError: _ignore,
      );

  setUp(() {
    sent = <String>[];
    announced = <AttachmentMetadata>[];
    attachments = build();
  });

  tearDown(() => attachments.dispose());

  Widget composer({
    bool fileUploads = true,
    ComposerController? controller,
  }) =>
      _host(Composer(
        onSend: sent.add,
        attachments: attachments,
        onSendAttachment: announced.add,
        fileUploads: fileUploads,
        controller: controller,
      ));

  group('the paperclip is reachable from the composer', () {
    testWidgets('the attach button is in the row when uploads are on',
        (WidgetTester tester) async {
      await tester.pumpWidget(composer());

      expect(
          find.widgetWithIcon(IconButton, Icons.attach_file), findsOneWidget);
    });

    testWidgets('and is absent entirely when RemoteConfig turns uploads off',
        (WidgetTester tester) async {
      await tester.pumpWidget(composer(fileUploads: false));

      expect(find.widgetWithIcon(IconButton, Icons.attach_file), findsNothing);
    });

    testWidgets(
        'fileUploads defaults to false, so a config that has not '
        'landed offers nothing', (WidgetTester tester) async {
      await tester.pumpWidget(_host(Composer(
        onSend: sent.add,
        attachments: attachments,
      )));

      expect(find.widgetWithIcon(IconButton, Icons.attach_file), findsNothing);
    });

    testWidgets('picking a file shows it in the draft bar',
        (WidgetTester tester) async {
      await tester.pumpWidget(composer());

      await tester.tap(find.widgetWithIcon(IconButton, Icons.attach_file));
      await tester.pumpAndSettle();

      expect(find.text('receipt.pdf'), findsOneWidget);
    });
  });

  group('a file with no words is a message', () {
    testWidgets('Send enables on a draft alone', (WidgetTester tester) async {
      await tester.pumpWidget(composer());
      expect(_sendEnabled(tester), isFalse);

      await attachments.pick();
      await tester.pump();

      expect(_sendEnabled(tester), isTrue,
          reason: 'a photo with no caption is the commonest attachment there '
              'is');
    });

    testWidgets('and sending it announces the file without an empty message',
        (WidgetTester tester) async {
      await tester.pumpWidget(composer());
      await attachments.pick();
      await tester.pump();

      await tester.tap(_sendButton);
      await tester.pumpAndSettle();

      expect(announced, hasLength(1));
      expect(announced.single.url, _uploaded.url);
      expect(sent, isEmpty, reason: 'there were no words to send');
    });
  });

  group('the three submit guards', () {
    testWidgets('an in-flight upload BLOCKS a send',
        (WidgetTester tester) async {
      // The upload is held open, so the whole test happens inside the window
      // a second send would race.
      final Completer<AttachmentMetadata> inFlight =
          Completer<AttachmentMetadata>();
      attachments.dispose();
      attachments = build(uploader: (PickedAttachment _) => inFlight.future);

      await tester.pumpWidget(composer());
      await attachments.pick();
      await tester.pump();
      await tester.enterText(_messageBox, 'first');
      await tester.pump();

      // The first send starts the upload and parks on it.
      await tester.tap(_sendButton);
      await tester.pump();
      expect(attachments.isUploading, isTrue);
      expect(attachments.canSend, isFalse);
      // The first layer: the button itself goes dead.
      expect(_sendEnabled(tester), isFalse);

      // A second send, mid-flight, made with the KEYBOARD.
      //
      // Deliberately not a second tap on Send: that button is already
      // disabled while `_uploading`, so a tap would be swallowed by the
      // button and would prove nothing about the guard. `onSubmitted` calls
      // `_submit` directly whatever the button's state — which is exactly
      // the "second Enter keypress" `AttachmentDraftController.canSend`
      // names as the reason it exists.
      await tester.enterText(_messageBox, 'second');
      await tester.pump();
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();

      expect(sent, isEmpty,
          reason: 'the second send must not slip past the in-flight upload');
      expect(announced, isEmpty);

      inFlight.complete(_uploaded);
      await tester.pumpAndSettle();
    });

    testWidgets('a failed upload keeps BOTH the draft and the typed text',
        (WidgetTester tester) async {
      attachments.dispose();
      attachments = build(
        uploader: (PickedAttachment _) async => throw StateError('offline'),
      );

      await tester.pumpWidget(composer());
      await attachments.pick();
      await tester.pump();
      await tester.enterText(_messageBox, 'here is the receipt');
      await tester.pump();

      await tester.tap(_sendButton);
      await tester.pumpAndSettle();

      // Nothing was sent...
      expect(sent, isEmpty);
      expect(announced, isEmpty);
      // ...and nothing was taken away. Retry is just pressing Send again,
      // which is only possible if both halves survived.
      expect(attachments.hasDraft, isTrue,
          reason: 'nothing queues an upload; this controller holds the only '
              'copy of the file');
      expect(
        tester.widget<TextField>(_messageBox).controller?.text,
        'here is the receipt',
        reason: 'the words must survive a failure the customer did not cause',
      );
      expect(find.text('receipt.pdf'), findsOneWidget);
    });

    testWidgets('a successful upload clears the box and announces the file',
        (WidgetTester tester) async {
      await tester.pumpWidget(composer());
      await attachments.pick();
      await tester.pump();
      await tester.enterText(_messageBox, 'here is the receipt');
      await tester.pump();

      await tester.tap(_sendButton);
      await tester.pumpAndSettle();

      expect(announced, hasLength(1));
      expect(sent, <String>['here is the receipt']);
      expect(attachments.hasDraft, isFalse);
      expect(tester.widget<TextField>(_messageBox).controller?.text, isEmpty);
    });

    testWidgets('a text-only send is untouched when a controller is present',
        (WidgetTester tester) async {
      await tester.pumpWidget(composer());
      await tester.enterText(_messageBox, 'just words');
      await tester.pump();

      await tester.tap(_sendButton);
      await tester.pumpAndSettle();

      expect(sent, <String>['just words']);
      expect(announced, isEmpty);
    });
  });

  group('canSend and the chip guard are ONE fact', () {
    testWidgets(
        'a suggestion chip is refused by the same in-flight upload '
        'that disables Send', (WidgetTester tester) async {
      final Completer<AttachmentMetadata> inFlight =
          Completer<AttachmentMetadata>();
      attachments.dispose();
      attachments = build(uploader: (PickedAttachment _) => inFlight.future);
      final ComposerController chips = ComposerController();

      await tester.pumpWidget(composer(controller: chips));
      await attachments.pick();
      await tester.pump();
      await tester.tap(_sendButton);
      await tester.pump();

      // The send button says no...
      expect(_sendEnabled(tester), isFalse);
      // ...and the chip path says no for the SAME reason, read off the same
      // flag rather than a second copy of it.
      expect(chips.submit('Track my order'), ChipSubmitRefusal.uploadInFlight);
      expect(sent, isEmpty);

      inFlight.complete(_uploaded);
      await tester.pumpAndSettle();
    });

    testWidgets('and both allow it again once the upload lands',
        (WidgetTester tester) async {
      final ComposerController chips = ComposerController();
      await tester.pumpWidget(composer(controller: chips));

      expect(chips.submit('Track my order'), isNull);
      await tester.pumpAndSettle();

      expect(sent, <String>['Track my order']);
    });

    testWidgets('the explicit uploading parameter still refuses a chip',
        (WidgetTester tester) async {
      // The parameter path a caller with no draft controller uses. It has to
      // keep working, because `_uploading` combines the two rather than
      // replacing one with the other.
      final ComposerController chips = ComposerController();
      await tester.pumpWidget(_host(Composer(
        onSend: sent.add,
        controller: chips,
        uploading: true,
      )));

      expect(chips.submit('Track my order'), ChipSubmitRefusal.uploadInFlight);
      expect(sent, isEmpty);
    });
  });

  group('an upload in flight shuts the other affordances', () {
    testWidgets('the emoji and link buttons go dead, as composer.ts does',
        (WidgetTester tester) async {
      final Completer<AttachmentMetadata> inFlight =
          Completer<AttachmentMetadata>();
      attachments.dispose();
      attachments = build(uploader: (PickedAttachment _) => inFlight.future);

      await tester.pumpWidget(composer());
      await attachments.pick();
      await tester.pump();
      await tester.tap(_sendButton);
      await tester.pump();

      expect(
        tester
            .widget<IconButton>(
                find.widgetWithIcon(IconButton, Icons.emoji_emotions_outlined))
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<IconButton>(find.widgetWithIcon(IconButton, Icons.link))
            .onPressed,
        isNull,
      );

      inFlight.complete(_uploaded);
      await tester.pumpAndSettle();
    });
  });

  group('the voice affordance', () {
    testWidgets('no controller means no microphone in the row',
        (WidgetTester tester) async {
      await tester.pumpWidget(composer());

      expect(find.byKey(const Key('composer.voice')), findsNothing);
    });
  });
}
