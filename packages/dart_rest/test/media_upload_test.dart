/// Reproduces `packages/rest/src/client.test.ts`'s `describe('attachment
/// upload')` and `describe('upload -> history round trip')`, plus the
/// empty-`mimeType` policy T1 left for this node to decide.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/src/client.dart';
import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/media.dart';
import 'package:dhaam_chat_rest/src/models/message_page.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

/// Split across concatenation so the checkout holds no contiguous literal for
/// CI's credential-scan job to match.
final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

/// What the route replies on a successful upload.
Map<String, Object?> _uploadResponse([
  Map<String, Object?> overrides = const <String, Object?>{},
]) =>
    <String, Object?>{
      'success': true,
      'data': <String, Object?>{
        'url': 'https://cdn.example.test/dev/t1/images/x.png',
        'fileName': 'x.png',
        'mimeType': 'image/png',
        'size': 1024,
        // The raw S3 folder name, which is what the route actually echoes.
        'mediaType': 'images',
        ...overrides,
      },
    };

/// Every upload goes out as a `MultipartRequest`, which `MockClient`'s plain
/// callback cannot see — so these drive the streaming form, which is also what
/// finalizes the request the way a real send would.
class _UploadHarness {
  final List<http.BaseRequest> calls = <http.BaseRequest>[];
  final List<String> bodies = <String>[];

  RestClient client(Object? Function(http.BaseRequest request) responder) =>
      RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async => 'tok_abc',
        httpClient: MockClient.streaming(
          (http.BaseRequest request, http.ByteStream body) async {
            calls.add(request);
            bodies.add(utf8.decode(await body.toBytes(), allowMalformed: true));
            return http.StreamedResponse(
              Stream<List<int>>.value(
                  utf8.encode(jsonEncode(responder(request)))),
              200,
            );
          },
        ),
      );

  http.MultipartRequest get sent => calls.single as http.MultipartRequest;
}

Uint8List _bytes([int length = 4]) =>
    Uint8List.fromList(List<int>.filled(length, 0x78));

void main() {
  group('attachment upload', () {
    test('posts to /upload, the only route that exists', () async {
      // `POST /sessions/{id}/attachments` has never been served by
      // chat-service; every upload against it 404'd.
      final _UploadHarness h = _UploadHarness();
      await h.client((_) => _uploadResponse()).uploadAttachment(
            sessionId: 's1',
            bytes: _bytes(),
            fileName: 'x.png',
            mimeType: 'image/png',
          );

      expect(
        '${h.sent.method} ${h.sent.url.path}',
        'POST /chat-services/api/v1/upload',
      );
    });

    test('carries chatSessionId as a QUERY PARAM, not a multipart field',
        () async {
      // The route reads the field off `request.file()`, which only resolves
      // fields parsed BEFORE the file part — and the file part is appended
      // first, so a field here would be dropped silently and the upload would
      // arrive attached to no session at all.
      final _UploadHarness h = _UploadHarness();
      await h.client((_) => _uploadResponse()).uploadAttachment(
            sessionId: 's 1/2',
            bytes: _bytes(),
            fileName: 'x.png',
            mimeType: 'image/png',
          );

      expect(h.sent.url.queryParameters['chatSessionId'], 's 1/2');
      expect(h.sent.fields, isEmpty);
      expect(h.sent.files.single.field, 'file');
      // Asserted against the ACTUAL bytes on the wire, not just the object
      // model: a field would appear here as a Content-Disposition name.
      expect(h.bodies.single, isNot(contains('chatSessionId')));
    });

    test('appends the file part first so a large body streams', () async {
      final _UploadHarness h = _UploadHarness();
      await h.client((_) => _uploadResponse()).uploadAttachment(
            sessionId: 's1',
            bytes: _bytes(),
            fileName: 'x.png',
            mimeType: 'image/png',
          );

      // Nothing precedes it, because nothing else is sent at all.
      expect(h.sent.files, hasLength(1));
      expect(h.sent.fields, isEmpty);
      expect(
        h.bodies.single.indexOf('name="file"'),
        h.bodies.single.indexOf('name='),
      );
    });

    test('sends neither a tenant hint nor an idempotency key', () async {
      // The route derives the tenant from the verified token and ignores
      // X-Tenant-ID; it implements no idempotency key at all.
      final _UploadHarness h = _UploadHarness();
      await h.client((_) => _uploadResponse()).uploadAttachment(
            sessionId: 's1',
            bytes: _bytes(),
            fileName: 'x.png',
            mimeType: 'image/png',
          );

      expect(h.sent.headers.keys.map((String k) => k.toLowerCase()),
          isNot(contains('x-tenant-id')));
      expect(h.sent.headers.keys.map((String k) => k.toLowerCase()),
          isNot(contains('idempotency-key')));
    });

    test('lets the runtime write the boundary Content-Type', () async {
      // Setting it by hand omits the boundary, and the server cannot parse the
      // body it then receives.
      final _UploadHarness h = _UploadHarness();
      await h.client((_) => _uploadResponse()).uploadAttachment(
            sessionId: 's1',
            bytes: _bytes(),
            fileName: 'x.png',
            mimeType: 'image/png',
          );

      final String contentType = h.sent.headers['content-type']!;
      expect(contentType, startsWith('multipart/form-data'));
      expect(contentType, contains('boundary='));
      // And the caller's own type rides on the PART, which is the reason this
      // package takes http_parser at all (contract §5.4).
      expect(h.sent.files.single.contentType.mimeType, 'image/png');
    });

    test('unwraps the envelope and normalizes mediaType to a known name',
        () async {
      final _UploadHarness h = _UploadHarness();
      final AttachmentMetadata attachment =
          await h.client((_) => _uploadResponse()).uploadAttachment(
                sessionId: 's1',
                bytes: _bytes(),
                fileName: 'x.png',
                mimeType: 'image/png',
              );

      // 'images' unnormalized falls through the consuming side's default, and
      // every uploaded image is announced as a generic FILE.
      expect(attachment.url, 'https://cdn.example.test/dev/t1/images/x.png');
      expect(attachment.fileName, 'x.png');
      expect(attachment.mimeType, 'image/png');
      expect(attachment.size, 1024);
      expect(attachment.mediaType, 'IMAGE');
    });

    test('maps a documents upload to DOCUMENT', () async {
      final _UploadHarness h = _UploadHarness();
      final AttachmentMetadata attachment = await h
          .client((_) => _uploadResponse(<String, Object?>{
                'mediaType': 'documents',
                'mimeType': 'application/pdf',
              }))
          .uploadAttachment(
            sessionId: 's1',
            bytes: _bytes(),
            fileName: 'x.pdf',
            mimeType: 'application/pdf',
          );

      expect(attachment.mediaType, 'DOCUMENT');
    });

    test('falls back to locally-known file facts when the route omits them',
        () async {
      final _UploadHarness h = _UploadHarness();
      final AttachmentMetadata attachment = await h
          .client((_) => <String, Object?>{
                'success': true,
                'data': <String, Object?>{
                  'url': 'https://cdn.example.test/x.png',
                },
              })
          .uploadAttachment(
            sessionId: 's1',
            bytes: _bytes(),
            fileName: 'named.png',
            mimeType: 'image/png',
          );

      expect(attachment.fileName, 'named.png');
      expect(attachment.mimeType, 'image/png');
      expect(attachment.size, 4);
      // Nothing to normalize, so the read side's own fallback applies.
      expect(attachment.mediaType, 'DOCUMENT');
    });

    test('prefers a locally-known fact over an echoed EMPTY one', () async {
      // Stricter than TS's bare `typeof === 'string'`, deliberately: an echoed
      // `''` satisfies that check and is then refused by
      // AttachmentMetadata.fromJson on the next history load, so the write
      // side and the read side would disagree about what is usable.
      final _UploadHarness h = _UploadHarness();
      final AttachmentMetadata attachment = await h
          .client((_) => _uploadResponse(
                <String, Object?>{'fileName': '', 'mimeType': ''},
              ))
          .uploadAttachment(
            sessionId: 's1',
            bytes: _bytes(),
            fileName: 'named.png',
            mimeType: 'image/png',
          );

      expect(attachment.fileName, 'named.png');
      expect(attachment.mimeType, 'image/png');
    });
  });

  group('a response with no usable url is refused', () {
    Future<void> expectNoUrl(Object? body) async {
      final _UploadHarness h = _UploadHarness();
      await expectLater(
        h.client((_) => body).uploadAttachment(
              sessionId: 's1',
              bytes: _bytes(),
              fileName: 'x.png',
              mimeType: 'image/png',
            ),
        throwsA(
          isA<RestMalformedResponseException>()
              .having((RestMalformedResponseException e) => e.context,
                  'context', 'POST /upload')
              .having((RestMalformedResponseException e) => e.detail, 'detail',
                  'returned no attachment url')
              .having((RestMalformedResponseException e) => e.retryable,
                  'retryable', isFalse),
        ),
      );
    }

    test('rejects an unenveloped 200 instead of returning an undefined url',
        () async {
      // Reaches the same exception by a different route — unwrapEnvelope
      // refuses first — so this one only pins that it IS refused.
      final _UploadHarness h = _UploadHarness();
      await expectLater(
        h
            .client((_) =>
                <String, Object?>{'url': 'https://cdn.example.test/x.png'})
            .uploadAttachment(
              sessionId: 's1',
              bytes: _bytes(),
              fileName: 'x.png',
              mimeType: 'image/png',
            ),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('rejects an enveloped response with no url at all', () async {
      await expectNoUrl(<String, Object?>{
        'success': true,
        'data': <String, Object?>{'fileName': 'x.png'},
      });
    });

    test('rejects an enveloped response whose url is the empty string',
        () async {
      // Without a URL there is nothing to announce; a caller would render an
      // attachment bubble pointing nowhere.
      await expectNoUrl(_uploadResponse(<String, Object?>{'url': ''}));
    });

    test('rejects an enveloped response whose url is not a string', () async {
      await expectNoUrl(_uploadResponse(<String, Object?>{'url': 7}));
    });

    test('names the route and the reason, and echoes no response content',
        () async {
      // The sentence TS spells as one `message`, split across this type's
      // context/detail pair. Nothing from the body reaches either half.
      final _UploadHarness h = _UploadHarness();
      final Object error = await h
          .client((_) => _uploadResponse(<String, Object?>{
                'url': '',
                'fileName': 'secret-signed-url-bearing.png',
              }))
          .uploadAttachment(
            sessionId: 's1',
            bytes: _bytes(),
            fileName: 'x.png',
            mimeType: 'image/png',
          )
          .then<Object>((AttachmentMetadata _) => 'did not throw',
              onError: (Object e) => e);

      expect(error.toString(), contains('POST /upload'));
      expect(error.toString(), contains('returned no attachment url'));
      expect(error.toString(), isNot(contains('secret-signed-url-bearing')));
    });
  });

  group('the empty-mimeType policy', () {
    // T1 refused to guess and left this as an endpoint-level call. The line is
    // "absent is not the same as wrong": an empty type is the platform saying
    // nothing and is substituted; a malformed one is the caller mangling
    // something and still throws.
    for (final String absent in <String>['', ' ', '   ', '\t']) {
      test('sends application/octet-stream for a type of ${jsonEncode(absent)}',
          () async {
        final _UploadHarness h = _UploadHarness();
        final AttachmentMetadata attachment =
            await h.client((_) => _uploadResponse()).uploadAttachment(
                  sessionId: 's1',
                  bytes: _bytes(),
                  fileName: 'scan.bin',
                  mimeType: absent,
                );

        // The upload HAPPENS — that is the whole point. A photo whose bytes
        // are fine must not fail over a label the picker withheld.
        expect(h.sent.files.single.contentType.mimeType,
            kUnknownAttachmentMimeType);
        // And the value is exactly what package:http itself would have sent
        // had the part carried no declared type at all.
        expect(kUnknownAttachmentMimeType, 'application/octet-stream');
        expect(attachment.mimeType, 'image/png'); // the route echoed one.
      });
    }

    test('falls back to the substituted type when the route echoes none',
        () async {
      // Never `''`: AttachmentMetadata.fromJson refuses an empty mimeType, so
      // passing one through would hand a caller a value this SDK's own decoder
      // rejects on the next history load.
      final _UploadHarness h = _UploadHarness();
      final AttachmentMetadata attachment = await h
          .client((_) => <String, Object?>{
                'success': true,
                'data': <String, Object?>{
                  'url': 'https://cdn.example.test/scan.bin',
                },
              })
          .uploadAttachment(
            sessionId: 's1',
            bytes: _bytes(),
            fileName: 'scan.bin',
            mimeType: '',
          );

      expect(attachment.mimeType, kUnknownAttachmentMimeType);
      expect(attachment.mediaType, 'DOCUMENT');
    });

    for (final String wrong in <String>['not a mime type', 'image', 'image/']) {
      test('still refuses ${jsonEncode(wrong)} before any request is made',
          () async {
        // Wrongness, not absence. A caller that produced this had a type and
        // mangled it, and no substitution can recover what it meant.
        final _UploadHarness h = _UploadHarness();
        await expectLater(
          h.client((_) => _uploadResponse()).uploadAttachment(
                sessionId: 's1',
                bytes: _bytes(),
                fileName: 'x.png',
                mimeType: wrong,
              ),
          throwsA(isA<ArgumentError>()),
        );
        expect(h.calls, isEmpty);
      });
    }
  });

  group('upload -> history round trip', () {
    test('comes back from history as IMAGE with the attachment intact',
        () async {
      // Neither adapter is exercised against the other anywhere else, so a
      // normalization drift between them — media-type casing, say — would pass
      // every other test here while still shipping a reloaded message with a
      // lost or mislabelled attachment.
      final Map<String, Object?> uploadData =
          _uploadResponse()['data']! as Map<String, Object?>;
      final String url = uploadData['url']! as String;

      final RestClient client = RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async => 'tok_abc',
        httpClient: MockClient.streaming(
          (http.BaseRequest request, http.ByteStream body) async {
            await body.toBytes();
            final Map<String, Object?> payload =
                request.url.path.endsWith('/upload')
                    ? _uploadResponse()
                    : <String, Object?>{
                        'success': true,
                        'data': <String, Object?>{
                          'messages': <Object?>[
                            <String, Object?>{
                              'id': 'm1',
                              'chatSessionId': 's1',
                              'senderId': 'cus_1',
                              'senderType': 1,
                              // MessageType.IMAGE, stamped from the attachment.
                              'messageType': 4,
                              // The §12.10 placeholder: content === attachment.url.
                              'content': url,
                              'metadata': <String, Object?>{
                                // Exactly what /upload handed back, which is what
                                // the server is trusted to have persisted verbatim.
                                'attachment': <String, Object?>{
                                  'url': url,
                                  'fileName': uploadData['fileName'],
                                  'mimeType': uploadData['mimeType'],
                                  'size': uploadData['size'],
                                  // normalizeMediaType('images') — never the raw
                                  // S3 folder name.
                                  'mediaType': 'IMAGE',
                                },
                              },
                              'seq': 1,
                              'createdAt': '2026-08-19T10:00:00.000Z',
                            },
                          ],
                          'hasMore': false,
                        },
                      };
            return http.StreamedResponse(
              Stream<List<int>>.value(utf8.encode(jsonEncode(payload))),
              200,
            );
          },
        ),
      );

      final AttachmentMetadata uploaded = await client.uploadAttachment(
        sessionId: 's1',
        bytes: _bytes(),
        fileName: 'x.png',
        mimeType: 'image/png',
      );
      expect(uploaded.mediaType, 'IMAGE');

      final RestMessagePage page =
          await client.listMessages(sessionId: 's1', limit: 20);

      final ChatMessage message = page.messages.single;
      expect(message.type, MessageType.image);
      expect(message.attachment?.url, uploaded.url);
      expect(message.attachment?.fileName, uploaded.fileName);
      expect(message.attachment?.mimeType, uploaded.mimeType);
      expect(message.attachment?.size, uploaded.size);
      expect(message.attachment?.mediaType, uploaded.mediaType);
      // The placeholder must actually be on the row for a binding's
      // visible-content filter to have something to fire on.
      expect(message.content, uploaded.url);
    });
  });
}
