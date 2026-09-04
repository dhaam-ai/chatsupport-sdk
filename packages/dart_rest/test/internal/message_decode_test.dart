/// Reproduces the message half of `packages/rest/src/projection.test.ts`:
/// `toChatMessage — integer enums`, `— field renames`, `— attachments buried
/// in metadata`, `attachment validation (forged metadata.attachment)`,
/// `metadata prototype-pollution keys` and `projectHistoryRow`.
library;

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/internal/attachment_safety.dart';
import 'package:dhaam_chat_rest/src/internal/message_decode.dart';
import 'package:test/test.dart';

const String _ctx = 'GET /chat/sessions/{sessionId}/messages';

/// A raw row as the REST path actually returns it — Prisma output,
/// unprojected. Mirrors `projection.test.ts`'s `messageRow` field for field.
///
/// Dart has no `undefined`, so a TS override of `{id: undefined}` — "the key
/// is present with no value" — is expressed here by passing `null`, which
/// every reader in this package treats identically to an absent key.
Map<String, Object?> messageRow([Map<String, Object?> overrides = const {}]) =>
    <String, Object?>{
      'id': 'm1',
      'chatSessionId': 's1',
      'senderId': 'cust-1',
      'senderType': 1,
      'messageType': 1,
      'content': 'hello',
      'metadata': null,
      'replyToMessageId': null,
      'createdAt': '2026-08-19T10:00:00.000Z',
      'seq': 7,
      ...overrides,
    };

const Map<String, Object?> _goodAttachment = <String, Object?>{
  'url': 'https://cdn.example.test/cat.png',
  'fileName': 'cat.png',
  'mimeType': 'image/png',
  'size': 1024,
  'mediaType': 'IMAGE',
};

void main() {
  group('decodeChatMessage — integer enums', () {
    for (final (int wire, SenderType expected) in <(int, SenderType)>[
      (1, SenderType.customer),
      (2, SenderType.agent),
      (3, SenderType.bot),
      (4, SenderType.system),
    ]) {
      test('decodes senderType $wire to ${expected.wire}', () {
        expect(
          decodeChatMessage(
                  messageRow(<String, Object?>{'senderType': wire}), _ctx)
              .senderType,
          expected,
        );
      });
    }

    for (final (int wire, MessageType expected) in <(int, MessageType)>[
      (1, MessageType.text),
      (2, MessageType.system),
      (3, MessageType.file),
      (4, MessageType.image),
      (5, MessageType.video),
      (6, MessageType.audio),
      (7, MessageType.typing),
    ]) {
      test('decodes messageType $wire to ${expected.wire}', () {
        expect(
          decodeChatMessage(
                  messageRow(<String, Object?>{'messageType': wire}), _ctx)
              .type,
          expected,
        );
      });
    }

    test('accepts the integral doubles Flutter Web decodes every enum into',
        () {
      // On Web the row's `2` arrives as `2.0`. Rejecting it would make history
      // undecodable on exactly one of three target platforms.
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{'senderType': 2.0, 'messageType': 4.0}),
        _ctx,
      );

      expect(message.senderType, SenderType.agent);
      expect(message.type, MessageType.image);
    });

    test('rejects an unmappable senderType rather than guessing a default', () {
      // Guessing would attribute an agent's message to the customer reading it.
      expect(
        () => decodeChatMessage(
            messageRow(<String, Object?>{'senderType': 9}), _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
      // The STRING form is unmappable here too: this route sends integers, and
      // a stray 'CUSTOMER' means something upstream changed shape.
      expect(
        () => decodeChatMessage(
            messageRow(<String, Object?>{'senderType': 'CUSTOMER'}), _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('rejects an unmappable messageType', () {
      // 0 specifically: the tables are 1-based and append-only.
      expect(
        () => decodeChatMessage(
            messageRow(<String, Object?>{'messageType': 0}), _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('never echoes the row into the failure it raises', () {
      final RestMalformedResponseException error = _catch(
        () => decodeChatMessage(
          messageRow(<String, Object?>{
            'senderType': 9,
            'content': 'my order number is 4111111111111111',
          }),
          _ctx,
        ),
      );

      expect(error.detail, contains('message.senderType'));
      expect(error.toString(), isNot(contains('4111111111111111')));
    });
  });

  group('decodeChatMessage — field renames', () {
    test('renames chatSessionId to sessionId and messageType to type', () {
      final ChatMessage message = decodeChatMessage(messageRow(), _ctx);

      expect(message.sessionId, 's1');
      expect(message.type, MessageType.text);
    });

    test('drops replyToMessage, the nested parent copy nothing models', () {
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{
          'replyToMessageId': 'm0',
          'replyToMessage': <String, Object?>{
            'id': 'm0',
            'content': 'earlier',
            'senderType': 2,
            'messageType': 1,
          },
        }),
        _ctx,
      );

      expect(message.replyToMessageId, 'm0');
      // There is nowhere on ChatMessage for it to have landed, and — the part
      // worth asserting — it did not leak into the metadata bag either.
      expect(message.metadata, isNull);
    });

    test('substitutes an empty senderId for a system message that has none',
        () {
      expect(
        decodeChatMessage(
          messageRow(<String, Object?>{'senderType': 4, 'senderId': null}),
          _ctx,
        ).senderId,
        '',
      );
    });

    test(
        'omits seq for a row that predates sequencing rather than failing the '
        'page', () {
      expect(
        decodeChatMessage(messageRow(<String, Object?>{'seq': null}), _ctx).seq,
        isNull,
      );
    });

    test('reads createdAt from an ISO string and from epoch millis alike', () {
      expect(
        decodeChatMessage(messageRow(), _ctx).createdAt,
        DateTime.utc(2026, 8, 19, 10),
      );
      // The cache-miss shape. TS's fixture uses `new Date(0)`; over HTTP that
      // is either an ISO string or a number, and both must land.
      expect(
        decodeChatMessage(messageRow(<String, Object?>{'createdAt': 0}), _ctx)
            .createdAt,
        DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      );
    });

    for (final (String label, Map<String, Object?> overrides)
        in <(String, Map<String, Object?>)>[
      ('id is missing', <String, Object?>{'id': null}),
      ('chatSessionId is missing', <String, Object?>{'chatSessionId': null}),
      (
        'createdAt is unparseable',
        <String, Object?>{'createdAt': 'not a date'}
      ),
    ]) {
      test('rejects a row where $label', () {
        expect(
          () => decodeChatMessage(messageRow(overrides), _ctx),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }

    test('rejects a non-object row', () {
      expect(
        () => decodeChatMessage(null, _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
      expect(
        () => decodeChatMessage(<Object?>[messageRow()], _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });
  });

  group('decodeChatMessage — attachments buried in metadata', () {
    test('lifts metadata.attachment to the top level', () {
      // Without this every reloaded image loses its attachment: the REST
      // history service does no metadata handling at all.
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{
          'messageType': 4,
          'metadata': <String, Object?>{'attachment': _goodAttachment},
        }),
        _ctx,
      );

      expect(message.attachment, isNotNull);
      expect(message.attachment!.url, 'https://cdn.example.test/cat.png');
      expect(message.attachment!.fileName, 'cat.png');
      expect(message.attachment!.mimeType, 'image/png');
      expect(message.attachment!.size, 1024);
      expect(message.attachment!.mediaType, 'IMAGE');
    });

    test('strips the attachment from the metadata it keeps', () {
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{
          'metadata': <String, Object?>{
            'attachment': _goodAttachment,
            'source': 'web',
            'locale': 'en',
          },
        }),
        _ctx,
      );

      expect(message.attachment, isNotNull);
      expect(
          message.metadata, <String, Object?>{'source': 'web', 'locale': 'en'});
    });

    test('leaves metadata absent when the attachment was all it held', () {
      // An empty map would be a second, contradictory answer to "is there
      // metadata?" — the ambiguity D4 exists to remove.
      expect(
        decodeChatMessage(
          messageRow(<String, Object?>{
            'metadata': <String, Object?>{'attachment': _goodAttachment},
          }),
          _ctx,
        ).metadata,
        isNull,
      );
    });

    test('keeps metadata that has no attachment in it', () {
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{
          'metadata': <String, Object?>{'source': 'web'},
        }),
        _ctx,
      );

      expect(message.metadata, <String, Object?>{'source': 'web'});
      expect(message.attachment, isNull);
    });

    for (final (String label, Object? metadata) in <(String, Object?)>[
      ('null', null),
      ('an empty object', <String, Object?>{}),
      // A `Json?` column places no constraint narrower than "valid JSON" on
      // what a row can hold. Either of these must degrade to no attachment and
      // no metadata rather than throw.
      ('a JSON-encoded string', '{"attachment":{"url":"x"}}'),
      ('an array', <Object?>['not', 'an', 'object']),
      ('a number', 3),
    ]) {
      test('leaves both fields absent when metadata is $label', () {
        final ChatMessage message = decodeChatMessage(
          messageRow(<String, Object?>{'metadata': metadata}),
          _ctx,
        );

        expect(message.attachment, isNull);
        expect(message.metadata, isNull);
      });
    }
  });

  group('attachment validation (forged metadata.attachment)', () {
    // Reachable: chat-service validates an inbound message.send attachment
    // only when the field is TOP-LEVEL, so a forged d.metadata.attachment is
    // persisted unvalidated and comes back on the next history load.
    for (final (String label, Object? attachment) in <(String, Object?)>[
      (
        'a javascript: url',
        <String, Object?>{
          ..._goodAttachment,
          'url': 'javascript:fetch("//evil")'
        }
      ),
      (
        'a data: url',
        <String, Object?>{
          ..._goodAttachment,
          'url': 'data:text/html,<script>1</script>',
        }
      ),
      (
        'a blob: url',
        <String, Object?>{
          ..._goodAttachment,
          'url': 'blob:https://evil.test/abc'
        }
      ),
      (
        'a protocol-relative url',
        <String, Object?>{..._goodAttachment, 'url': '//attacker.example/b'}
      ),
      ('a non-string url', <String, Object?>{..._goodAttachment, 'url': 123}),
      (
        'no url at all',
        <String, Object?>{
          'fileName': 'a',
          'mimeType': 'b',
          'size': 1,
          'mediaType': 'IMAGE',
        }
      ),
      (
        'an empty fileName',
        <String, Object?>{..._goodAttachment, 'fileName': ''}
      ),
      (
        'a missing mimeType',
        <String, Object?>{..._goodAttachment, 'mimeType': null}
      ),
      (
        'a non-finite size',
        <String, Object?>{..._goodAttachment, 'size': double.nan}
      ),
      ('a string size', <String, Object?>{..._goodAttachment, 'size': '1024'}),
      (
        'an empty mediaType',
        <String, Object?>{..._goodAttachment, 'mediaType': ''}
      ),
      ('an array', <Object?>[_goodAttachment]),
      ('a string', 'https://cdn.example.test/cat.png'),
      ('null', null),
    ]) {
      test('drops an attachment with $label', () {
        final ChatMessage message = decodeChatMessage(
          messageRow(<String, Object?>{
            'metadata': <String, Object?>{'attachment': attachment},
          }),
          _ctx,
        );

        expect(message.attachment, isNull);
        // And it must not survive by the back door either: the `attachment`
        // key is stripped from the surviving bag whether or not it validated.
        expect(message.metadata, isNull);
      });
    }

    test('drops the bad attachment without failing the row', () {
      // Dropping, not throwing — consistent with tolerating a row that
      // predates sequencing. One forged attachment must not cost the customer
      // the message.
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{
          'content': 'look at this',
          'metadata': <String, Object?>{
            'attachment': <String, Object?>{'url': 'javascript:1'},
          },
        }),
        _ctx,
      );

      expect(message.id, 'm1');
      expect(message.content, 'look at this');
    });

    test('accepts a well-formed https attachment', () {
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{
          'metadata': <String, Object?>{'attachment': _goodAttachment},
        }),
        _ctx,
      );

      expect(message.attachment?.url, 'https://cdn.example.test/cat.png');
    });

    test('accepts an http attachment and is case-insensitive about the scheme',
        () {
      expect(
        readAttachmentMetadata(<String, Object?>{
          ..._goodAttachment,
          'url': 'HTTP://cdn.example.test/cat.png',
        }),
        isNotNull,
      );
    });

    test('accepts an integral-double size, which is every size on Web', () {
      expect(
        readAttachmentMetadata(
          <String, Object?>{..._goodAttachment, 'size': 1024.0},
        )?.size,
        1024,
      );
    });

    test('refuses a fractional size — a divergence from TS, deliberately', () {
      // TS accepts any finite number and hands it to core. `size` is an `int`
      // here and 1024.5 describes no file, so it is refused. Losing the
      // attachment, not the row, is the same tradeoff every other drop above
      // makes.
      expect(
        readAttachmentMetadata(
          <String, Object?>{..._goodAttachment, 'size': 1024.5},
        ),
        isNull,
      );
    });

    test('rebuilds the attachment, dropping unvalidated extra keys', () {
      // Structural in Dart: a five-parameter constructor has nowhere to put a
      // sixth key. Asserted anyway, because it is the property that matters
      // and it should not depend on nobody later swapping the constructor for
      // a map copy.
      final AttachmentMetadata? attachment = readAttachmentMetadata(
        <String, Object?>{
          ..._goodAttachment,
          'extra': 'ignored',
          'isAdmin': true,
        },
      );

      expect(attachment, isNotNull);
      expect(attachment!.toJson().keys.toList(), <String>[
        'url',
        'fileName',
        'mimeType',
        'size',
        'mediaType',
      ]);
    });

    test('exposes the reader so a hand-written decoder can reuse it', () {
      expect(readAttachmentMetadata(_goodAttachment), isNotNull);
      expect(
        readAttachmentMetadata(
          <String, Object?>{..._goodAttachment, 'url': 'javascript:1'},
        ),
        isNull,
      );
    });
  });

  group('metadata keys that are JS-specific and are NOT stripped here', () {
    // The counterpart to projection.test.ts's "metadata prototype-pollution
    // keys" block, asserting the OPPOSITE outcome — deliberately, per contract
    // §5.8.
    //
    // TS strips __proto__/constructor/prototype because `JSON.parse` makes
    // `__proto__` an OWN property, so a polluted bag can detach the prototype
    // of anything a host app later deep-merges it onto. `jsonDecode` produces
    // a plain Map with no prototype chain, so there is no vulnerability class
    // here to close and those keys stay as ordinary application data.
    //
    // This is asserted rather than left silent so the decision is on record as
    // tested behaviour. If a Dart-side reason to strip them ever emerges, this
    // test is what fails and forces the conversation.
    test('a key named __proto__ survives as ordinary metadata', () {
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{
          'metadata': <String, Object?>{
            '__proto__': <String, Object?>{'isAdmin': true},
            'constructor': <String, Object?>{'x': 1},
            'prototype': <String, Object?>{'y': 2},
            'source': 'web',
          },
        }),
        _ctx,
      );

      expect(message.metadata?.keys.toList(), <String>[
        '__proto__',
        'constructor',
        'prototype',
        'source',
      ]);
    });

    test('and detaches nothing — a Dart Map has no prototype to pollute', () {
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{
          'metadata': <String, Object?>{
            '__proto__': <String, Object?>{'isAdmin': true},
          },
        }),
        _ctx,
      );

      // The proof that the JS threat does not transfer: the key is an ordinary
      // entry, and an unrelated map is unaffected by its existence.
      expect(message.metadata!['__proto__'], isA<Map<String, Object?>>());
      expect(<String, Object?>{}.containsKey('isAdmin'), isFalse);
    });

    test('but `attachment` IS still stripped — one canonical location (D4)',
        () {
      final ChatMessage message = decodeChatMessage(
        messageRow(<String, Object?>{
          'metadata': <String, Object?>{
            'attachment': _goodAttachment,
            'keep': 'me',
          },
        }),
        _ctx,
      );

      expect(message.metadata, <String, Object?>{'keep': 'me'});
    });
  });

  group('projectHistoryRow — one bad row must not cost a page', () {
    test('projects a good row exactly as decodeChatMessage does', () {
      final ChatMessage? projected = projectHistoryRow(messageRow(), _ctx);
      final ChatMessage decoded = decodeChatMessage(messageRow(), _ctx);

      expect(projected, isNotNull);
      expect(projected!.id, decoded.id);
      expect(projected.sessionId, decoded.sessionId);
      expect(projected.senderType, decoded.senderType);
      expect(projected.type, decoded.type);
      expect(projected.content, decoded.content);
      expect(projected.seq, decoded.seq);
      expect(projected.createdAt, decoded.createdAt);
      expect(projected.metadata, decoded.metadata);
    });

    test('returns a placeholder for an undecodable senderType', () {
      final ChatMessage? message = projectHistoryRow(
          messageRow(<String, Object?>{'senderType': 99}), _ctx);

      expect(message, isNotNull);
      expect(message!.id, 'm1');
      expect(message.sessionId, 's1');
      expect(message.senderId, '');
      expect(message.senderType, SenderType.system);
      expect(message.type, MessageType.system);
      expect(message.content, '');
      expect(message.seq, 7);
      expect(message.createdAt, DateTime.utc(2026, 8, 19, 10));
      expect(
          message.metadata, <String, Object?>{kUnsupportedMessageMarker: true});
      expect(message.attachment, isNull);
    });

    test('returns a placeholder for an undecodable messageType', () {
      // The sender decoded here, but the placeholder still says SYSTEM: naming
      // an author is the misattribution risk the decoder throws to avoid, and
      // understating a known sender is the safe direction to be wrong in.
      final ChatMessage? message = projectHistoryRow(
        messageRow(<String, Object?>{'senderType': 2, 'messageType': 42}),
        _ctx,
      );

      expect(message?.senderType, SenderType.system);
      expect(message?.type, MessageType.system);
      expect(message?.senderId, '');
    });

    test('never claims an author it could not decode', () {
      final ChatMessage? message = projectHistoryRow(
        messageRow(<String, Object?>{'senderType': 99, 'senderId': 'agent-9'}),
        _ctx,
      );

      expect(message?.senderId, '');
      expect(message?.senderType, SenderType.system);
    });

    test('drops the content of a message whose type it does not understand',
        () {
      // A future card format's payload rendered as raw prose is worse than a
      // notice.
      final ChatMessage? message = projectHistoryRow(
        messageRow(<String, Object?>{
          'messageType': 42,
          'content': '{"card":{"v":2,"blocks":[]}}',
        }),
        _ctx,
      );

      expect(message?.content, '');
    });

    test('discards the metadata of a row it could not decode', () {
      final ChatMessage? message = projectHistoryRow(
        messageRow(<String, Object?>{
          'senderType': 99,
          'metadata': <String, Object?>{
            'source': 'web',
            'attachment': <String, Object?>{'url': 'javascript:1'},
          },
        }),
        _ctx,
      );

      expect(message?.metadata,
          <String, Object?>{kUnsupportedMessageMarker: true});
      expect(message?.attachment, isNull);
    });

    for (final (String label, Map<String, Object?> overrides)
        in <(String, Map<String, Object?>)>[
      ('no id', <String, Object?>{'id': null}),
      ('no chatSessionId', <String, Object?>{'chatSessionId': null}),
      ('an unparseable createdAt', <String, Object?>{'createdAt': 'nope'}),
    ]) {
      test(
          'returns null when a placeholder would have $label to key or order '
          'by', () {
        expect(
          projectHistoryRow(
            messageRow(<String, Object?>{'senderType': 99, ...overrides}),
            _ctx,
          ),
          isNull,
        );
      });
    }

    test('returns null for a row that is not an object at all', () {
      expect(projectHistoryRow(null, _ctx), isNull);
      expect(projectHistoryRow('nope', _ctx), isNull);
      expect(projectHistoryRow(<Object?>[], _ctx), isNull);
    });

    test('omits seq when the undecodable row had none', () {
      final ChatMessage? message = projectHistoryRow(
        messageRow(<String, Object?>{'senderType': 99, 'seq': null}),
        _ctx,
      );

      expect(message, isNotNull);
      expect(message!.seq, isNull);
    });

    test('one bad row costs one row, never the page', () {
      // The whole point, stated as the caller would experience it.
      final List<Map<String, Object?>> rows = <Map<String, Object?>>[
        messageRow(<String, Object?>{'id': 'm1'}),
        messageRow(<String, Object?>{'id': 'm2', 'senderType': 99}),
        messageRow(<String, Object?>{'id': 'm3'}),
      ];

      final List<ChatMessage?> projected = rows
          .map((Map<String, Object?> row) => projectHistoryRow(row, _ctx))
          .toList();

      expect(projected.map((ChatMessage? m) => m?.id).toList(),
          <String?>['m1', 'm2', 'm3']);
      expect(projected[1]!.senderType, SenderType.system);
      expect(projected[0]!.senderType, SenderType.customer);
    });
  });
}

RestMalformedResponseException _catch(void Function() body) {
  try {
    body();
  } on RestMalformedResponseException catch (error) {
    return error;
  }
  fail('expected a RestMalformedResponseException');
}
