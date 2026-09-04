/// The barrel really does carry T7's surface — including the one piece that
/// is not a type and cannot be checked by naming it.
///
/// ── Why this file exists separately from `media_*_test.dart` ──────────────
///
/// Those four import `src/media.dart` directly, which is what makes their
/// assertions about behaviour rather than about packaging. That leaves a real
/// gap: a Dart extension's methods are only applicable where the EXTENSION
/// ITSELF is in scope, so dropping `MediaApi` from the barrel's `show` list
/// would break `client.listMessages(...)` at every consumer while every test
/// in this package kept passing. This file imports ONLY the barrel, so it
/// would not compile if that happened.
///
/// It is deliberately not folded into `barrel_test.dart`: that file is shared
/// with the other nodes extending this package in parallel, and a new file
/// costs nothing while an edit there risks a collision.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:dhaam_chat_rest/dhaam_chat_rest.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

final PublishableKey _key = PublishableKey.parse('dhp' '_test_' '${'A' * 43}');

void main() {
  group('the barrel carries T7 surface', () {
    test('makes the MediaApi extension APPLICABLE, not merely named', () async {
      // The assertion is that this line compiles and runs: an extension whose
      // declaration is not in scope is not an extension a caller can use.
      final RestClient client = RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey: _key,
        getAccessToken: () async => 'tok_abc',
        httpClient: MockClient((http.Request _) async => http.Response(
              jsonEncode(<String, Object?>{
                'success': true,
                'data': <String, Object?>{
                  'messages': <Object?>[],
                  'hasMore': false,
                },
              }),
              200,
            )),
      );

      final RestMessagePage page =
          await client.listMessages(sessionId: 's1', limit: 20);
      expect(page.hasMore, isFalse);

      // Named so a `show` list that forgets them fails to compile here.
      expect(client.uploadAttachment, isNotNull);
      expect(client.identify, isNotNull);
    });

    test('exposes the contact-info seam and its vocabulary', () {
      expect(kGeolocationTimeout, isA<Duration>());
      expect(kUnknownAttachmentMimeType, 'application/octet-stream');
      expect(const RestGeoPosition(lat: 1, lng: 2).lat, 1);
      expect(const RestContactInfo(userAgent: 'UA').userAgent, 'UA');

      // The two typedefs, named through the barrel. `isA` rather than
      // `isNotNull` because the claim is structural: what a host actually
      // writes must SATISFY these types, not merely be assigned to a variable
      // annotated with them.
      Future<RestGeoPosition?> probe(Duration timeout) async => null;
      void sink(RestContactInfo info) {}

      expect(probe, isA<GeolocationProbe>());
      expect(sink, isA<ContactInfoSink>());
      expect(captureContactInfo, isNotNull);
    });

    test('an upload announced over the socket needs no conversion', () {
      // The reason uploadAttachment returns dhaam_chat's own type rather than
      // a parallel one: it is the SAME type a message.new frame decodes an
      // attachment into, so a caller that uploads here and announces over the
      // socket passes the value straight through. Assignability is the whole
      // claim, and the barrel re-exports the type so one import proves it.
      const AttachmentMetadata uploaded = AttachmentMetadata(
        url: 'https://cdn.example.test/x.png',
        fileName: 'x.png',
        mimeType: 'image/png',
        size: 4,
        mediaType: 'IMAGE',
      );

      expect(uploaded.toJson()['mediaType'], 'IMAGE');
      expect(Uint8List(0), isEmpty);
    });
  });
}
