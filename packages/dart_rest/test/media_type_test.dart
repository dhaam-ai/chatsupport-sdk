/// Reproduces `packages/rest/src/media-type.test.ts`.
library;

import 'package:dhaam_chat_rest/src/media_type.dart';
import 'package:test/test.dart';

void main() {
  group('normalizeMediaType', () {
    for (final (String folder, String expected) in <(String, String)>[
      ('images', 'IMAGE'),
      ('videos', 'VIDEO'),
      ('audio', 'AUDIO'),
      ('documents', 'DOCUMENT'),
    ]) {
      test('maps the S3 folder $folder to $expected', () {
        // These four are the only values s3-client's getMediaFolder can
        // produce.
        expect(normalizeMediaType(folder), expected);
      });
    }

    for (final String name in <String>['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']) {
      test('passes an already-correct $name through unchanged', () {
        expect(normalizeMediaType(name), name);
      });
    }

    for (final (String label, Object? value) in <(String, Object?)>[
      ('an unrecognized string', 'sticker'),
      ('an empty string', ''),
      ('null', null),
      ('a number', 4),
      ('an object', <String, Object?>{'mediaType': 'images'}),
      ('a list', <Object?>['images']),
      ('a bool', true),
    ]) {
      test('falls back to DOCUMENT for $label', () {
        // Mirrors s3-client's own fallback; DOCUMENT then degrades to a
        // generic FILE attachment, so an unknown kind still sends rather than
        // failing the upload. An upload is not worth failing over a label.
        expect(normalizeMediaType(value), 'DOCUMENT');
      });
    }

    test('tolerates surrounding whitespace and mixed case', () {
      expect(normalizeMediaType('  Images '), 'IMAGE');
    });
  });
}
