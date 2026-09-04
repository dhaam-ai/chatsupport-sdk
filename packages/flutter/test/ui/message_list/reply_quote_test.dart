// Reproduces `message-list.test.ts`'s `readReplyQuote` block. The bag is
// another participant's client's data, so every assertion here is about
// what the parse REFUSES.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _quote({Object? senderName = 'Kai', Object? excerpt}) {
  return <String, Object?>{
    'kind': 'reply',
    'replyTo': <String, Object?>{
      'senderName': senderName,
      'excerpt': excerpt ?? 'where is my order',
    },
  };
}

void main() {
  group('readReplyQuote', () {
    test('reads a well-formed quote, trimmed', () {
      expect(
        readReplyQuote(_quote(senderName: '  Kai  ', excerpt: '  hello  ')),
        const ReplyQuote(senderName: 'Kai', excerpt: 'hello'),
      );
    });

    test('null, a non-map, and a bag of the wrong kind all yield null', () {
      expect(readReplyQuote(null), isNull);
      expect(readReplyQuote('reply'), isNull);
      expect(readReplyQuote(<String, Object?>{}), isNull);
      expect(
        readReplyQuote(<String, Object?>{'kind': 'forward', 'replyTo': {}}),
        isNull,
      );
    });

    test('a missing or non-map replyTo yields null', () {
      expect(readReplyQuote(<String, Object?>{'kind': 'reply'}), isNull);
      expect(
        readReplyQuote(<String, Object?>{'kind': 'reply', 'replyTo': 'nope'}),
        isNull,
      );
    });

    test('a non-string name or excerpt yields null', () {
      expect(readReplyQuote(_quote(senderName: 42)), isNull);
      expect(readReplyQuote(_quote(excerpt: <Object?>[])), isNull);
    });

    test('both or nothing — a blank on either side yields null', () {
      // A quote naming nobody, or naming someone who said nothing, reads as
      // a rendering bug rather than as context.
      expect(readReplyQuote(_quote(senderName: '   ')), isNull);
      expect(readReplyQuote(_quote(excerpt: '')), isNull);
    });

    test('re-enforces the 160-char cap the wire contract sets at 120', () {
      // The record arrives from another participant's client, so the cap is
      // enforced again here rather than assumed.
      final String long = 'x' * 400;
      final ReplyQuote? quote = readReplyQuote(_quote(excerpt: long));
      expect(quote, isNotNull);
      expect(quote!.excerpt.length, kMaxQuoteExcerpt);
      expect(quote.excerpt.endsWith('…'), isTrue);
      expect(kMaxQuoteExcerpt, 160);
    });

    test('an excerpt exactly at the cap is left alone', () {
      final String exact = 'y' * kMaxQuoteExcerpt;
      expect(readReplyQuote(_quote(excerpt: exact))?.excerpt, exact);
    });
  });
}
