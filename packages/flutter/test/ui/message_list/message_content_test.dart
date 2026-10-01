// Reproduces `message-list.test.ts`'s §12.10 assertions — the ones that
// pin the placeholder comparison to `attachment.url` SPECIFICALLY rather
// than to "an attachment exists", and that make the bubble text and the
// screen-reader announcement one function.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

const String _url = 'https://cdn.example.com/receipts/receipt.png';

AttachmentMetadata _attachment({
  String url = _url,
  String mimeType = 'image/png',
  String fileName = 'receipt.png',
  String mediaType = 'image',
}) {
  return AttachmentMetadata(
    url: url,
    fileName: fileName,
    mimeType: mimeType,
    size: 10,
    mediaType: mediaType,
  );
}

ChatMessage _message({
  String content = 'where is my order',
  AttachmentMetadata? attachment,
}) {
  return ChatMessage(
    id: 'm1',
    sessionId: 's1',
    senderId: 'agt_9',
    senderType: SenderType.agent,
    type: MessageType.text,
    content: content,
    seq: 1,
    createdAt: DateTime.utc(2026, 8, 19, 10),
    attachment: attachment,
  );
}

void main() {
  group('visibleContent — the §12.10 quirk', () {
    test('suppresses content that IS the attachment url', () {
      final ChatMessage message =
          _message(content: _url, attachment: _attachment());
      expect(visibleContent(message), '');
    });

    test('keeps a real caption sent alongside an attachment', () {
      // The reason the comparison is against `attachment.url` specifically
      // and not "an attachment is present": an agent can caption a file,
      // and that caption is a distinct string that must still render.
      final ChatMessage message =
          _message(content: 'here is your receipt', attachment: _attachment());
      expect(visibleContent(message), 'here is your receipt');
    });

    test('keeps content that merely mentions a different url', () {
      final ChatMessage message = _message(
        content: 'https://cdn.example.com/receipts/other.png',
        attachment: _attachment(),
      );
      expect(
        visibleContent(message),
        'https://cdn.example.com/receipts/other.png',
      );
    });

    test('a message with no attachment is returned unchanged', () {
      expect(visibleContent(_message(content: _url)), _url);
    });
  });

  group('describeContent — what the live region says', () {
    test('speaks the visible words when there are any', () {
      expect(
        describeContent(_message(content: 'ten minutes away')),
        'ten minutes away',
      );
    });

    test('falls back to the attachment kind once the url is suppressed', () {
      // Same function underneath, so the bubble and the announcement can
      // never disagree about whether there were words to read.
      final ChatMessage image =
          _message(content: _url, attachment: _attachment());
      expect(visibleContent(image), '');
      expect(describeContent(image), 'sent an image');

      final ChatMessage audio = _message(
        content: 'https://cdn.example.com/vm.m4a',
        attachment: _attachment(
          url: 'https://cdn.example.com/vm.m4a',
          mimeType: 'audio/mp4',
          mediaType: 'audio',
        ),
      );
      expect(describeContent(audio), 'sent a voice message');

      final ChatMessage file = _message(
        content: 'https://cdn.example.com/invoice.pdf',
        attachment: _attachment(
          url: 'https://cdn.example.com/invoice.pdf',
          mimeType: 'application/pdf',
          mediaType: 'documents',
        ),
      );
      expect(describeContent(file), 'sent a file');
    });

    test('names a video as a video, not as a file', () {
      // The S3 folder name the agent console sends, unnormalized. The bubble
      // draws a video glyph for it, so the announcement must agree.
      final ChatMessage video = _message(
        content: 'https://cdn.example.com/clip.mp4',
        attachment: _attachment(
          url: 'https://cdn.example.com/clip.mp4',
          mimeType: 'video/mp4',
          mediaType: 'videos',
        ),
      );
      expect(describeContent(video), 'sent a video');
    });

    test('says what the bubble draws when mediaType and mimeType disagree', () {
      // A recognized mediaType is the classifier for the announcement too, so
      // the words cannot contradict the glyph next to them.
      final ChatMessage scan = _message(
        content: 'https://cdn.example.com/scan.png',
        attachment: _attachment(
          url: 'https://cdn.example.com/scan.png',
          mimeType: 'image/png',
          mediaType: 'DOCUMENT',
        ),
      );
      expect(describeContent(scan), 'sent a file');
    });

    test('a whitespace-only message is described, not read out blank', () {
      expect(describeContent(_message(content: '   ')), 'sent a message');
    });
  });
}
