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
}) {
  return AttachmentMetadata(
    url: url,
    fileName: fileName,
    mimeType: mimeType,
    size: 10,
    mediaType: 'image',
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

    test('falls back to the mime family once the url is suppressed', () {
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
        ),
      );
      expect(describeContent(audio), 'sent a voice message');

      final ChatMessage file = _message(
        content: 'https://cdn.example.com/invoice.pdf',
        attachment: _attachment(
          url: 'https://cdn.example.com/invoice.pdf',
          mimeType: 'application/pdf',
        ),
      );
      expect(describeContent(file), 'sent a file');
    });

    test('a whitespace-only message is described, not read out blank', () {
      expect(describeContent(_message(content: '   ')), 'sent a message');
    });
  });
}
