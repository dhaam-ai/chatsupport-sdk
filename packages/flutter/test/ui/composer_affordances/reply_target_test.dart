// The reply target: what the chip shows, and what the send quotes.
//
// The excerpt is captured HERE, once, when the customer presses Reply — not
// re-read at send time — so these assertions are the whole of what the other
// participant will eventually be shown. The round-trip group at the bottom is
// the one that matters most: `ReplyTarget.metadata` and `readReplyQuote` are
// the two halves of one wire shape written by two different nodes, and a
// `kind` string that disagrees is not a compile error, it is a quote that
// silently never renders.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

ChatMessage _message({
  String id = 'm1',
  String content = 'Hello there',
  AttachmentMetadata? attachment,
}) =>
    ChatMessage(
      id: id,
      sessionId: 's1',
      senderId: 'agent-1',
      senderType: SenderType.agent,
      type: MessageType.text,
      content: content,
      seq: 1,
      createdAt: DateTime.utc(2026, 1, 1),
      attachment: attachment,
      delivery: MessageDelivery.confirmed,
    );

const AttachmentMetadata _file = AttachmentMetadata(
  url: 'https://cdn.example.com/signed/receipt.pdf',
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  mediaType: 'DOCUMENT',
);

void main() {
  group('ReplyTarget.from', () {
    test('carries the id, the resolved name and the message text', () {
      final ReplyTarget target =
          ReplyTarget.from(_message(), senderName: 'Alex');

      expect(target.messageId, 'm1');
      expect(target.senderName, 'Alex');
      expect(target.excerpt, 'Hello there');
    });

    test('the sender name is the transcript\'s, never read off the message',
        () {
      // A ChatMessage carries no display name at all — only the message list
      // can resolve one, and the customer's own rows resolve to "You".
      expect(
        ReplyTarget.from(_message(), senderName: 'You').senderName,
        'You',
      );
    });

    test('collapses newlines and runs of whitespace to single spaces', () {
      final ReplyTarget target = ReplyTarget.from(
        _message(content: 'First line\n\nSecond   line\ttabbed'),
        senderName: 'Alex',
      );

      // A chip above the input is one line. A quote that wrapped would push
      // the composer down the screen or be clipped mid-word.
      expect(target.excerpt, 'First line Second line tabbed');
    });

    test('quotes an attachment as "Attachment", never its signed url', () {
      // §12.10: a plain attachment arrives with `content` SET TO the url. The
      // bug this closes is a storage URL shown to the customer as though it
      // were something somebody said.
      final ReplyTarget target = ReplyTarget.from(
        _message(content: _file.url, attachment: _file),
        senderName: 'Alex',
      );

      expect(target.excerpt, 'Attachment');
      expect(target.excerpt, isNot(contains('cdn.example.com')));
    });

    test('a real caption beside an attachment is quoted, not suppressed', () {
      final ReplyTarget target = ReplyTarget.from(
        _message(content: 'Here is the receipt', attachment: _file),
        senderName: 'Alex',
      );

      expect(target.excerpt, 'Here is the receipt');
    });

    test('a message with no words and no attachment is not called a file', () {
      // The reference says "Attachment" unconditionally. For a record that
      // arrived with an empty content and nothing attached that would
      // describe a file the customer cannot see.
      final ReplyTarget target =
          ReplyTarget.from(_message(content: '   '), senderName: 'Alex');

      expect(target.excerpt, 'Message');
    });

    test('caps a long excerpt at the render side\'s own limit', () {
      final ReplyTarget target = ReplyTarget.from(
        _message(content: 'x' * 400),
        senderName: 'Alex',
      );

      // Never LONGER than the cap it is named for: the ellipsis takes the
      // last slot rather than being appended.
      expect(target.excerpt.length, kMaxQuoteExcerpt);
      expect(target.excerpt.endsWith('…'), isTrue);
    });

    test('leaves an excerpt at exactly the cap untouched', () {
      final ReplyTarget target = ReplyTarget.from(
        _message(content: 'y' * kMaxQuoteExcerpt),
        senderName: 'Alex',
      );

      expect(target.excerpt, 'y' * kMaxQuoteExcerpt);
      expect(target.excerpt.endsWith('…'), isFalse);
    });

    test('compares by value, so an unchanged target re-emits nothing', () {
      expect(
        ReplyTarget.from(_message(), senderName: 'Alex'),
        ReplyTarget.from(_message(), senderName: 'Alex'),
      );
      expect(
        ReplyTarget.from(_message(), senderName: 'Alex'),
        isNot(ReplyTarget.from(_message(id: 'm2'), senderName: 'Alex')),
      );
    });
  });

  group('the wire shape, both halves', () {
    test('metadata is the exact bag readReplyQuote parses', () {
      final ReplyTarget target =
          ReplyTarget.from(_message(), senderName: 'Alex');

      final ReplyQuote? quote = readReplyQuote(target.metadata);

      // The writer and the reader are one round trip apart. If either side's
      // `kind` string or key names drift, this is where it shows — not in
      // front of a customer looking at a reply with no quote above it.
      expect(quote, isNotNull);
      expect(quote!.senderName, 'Alex');
      expect(quote.excerpt, 'Hello there');
    });

    test('metadata names the message as well as quoting it', () {
      final ReplyTarget target =
          ReplyTarget.from(_message(), senderName: 'Alex');

      expect(
        target.metadata['replyTo'],
        containsPair('messageId', 'm1'),
      );
    });

    test('a capped excerpt survives the round trip unchanged', () {
      // Producing against the render side's own constant is what makes this
      // true: an excerpt the chip showed is never re-trimmed on arrival, so
      // the two can never say different things.
      final ReplyTarget target = ReplyTarget.from(
        _message(content: 'z' * 400),
        senderName: 'Alex',
      );

      expect(readReplyQuote(target.metadata)!.excerpt, target.excerpt);
    });
  });
}
