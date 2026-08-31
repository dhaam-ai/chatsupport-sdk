// Mirrors packages/widget/test's coverage of dom.ts's safeImageUrl — same
// accepted/refused cases, ported rather than re-derived.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('safeImageUrl', () {
    test('accepts https and http', () {
      expect(safeImageUrl('https://example.com/logo.png'), 'https://example.com/logo.png');
      expect(safeImageUrl('http://example.com/logo.png'), 'http://example.com/logo.png');
    });

    test('accepts a data:image/* URI in the allowed subtypes', () {
      expect(safeImageUrl('data:image/png;base64,abcd'), isNotNull);
      expect(safeImageUrl('data:image/svg+xml;base64,abcd'), isNotNull);
    });

    test('is case-insensitive on the scheme', () {
      expect(safeImageUrl('HTTPS://example.com/logo.png'), isNotNull);
    });

    test('trims whitespace', () {
      expect(safeImageUrl('  https://example.com/logo.png  '), 'https://example.com/logo.png');
    });

    test('refuses null, blank, and non-image/non-http schemes', () {
      expect(safeImageUrl(null), isNull);
      expect(safeImageUrl(''), isNull);
      expect(safeImageUrl('   '), isNull);
      expect(safeImageUrl('javascript:alert(1)'), isNull);
      expect(safeImageUrl('/relative/path.png'), isNull);
      expect(safeImageUrl('file:///etc/passwd'), isNull);
      expect(safeImageUrl('data:text/html,<script>'), isNull);
    });
  });
}
