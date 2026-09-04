import 'package:dhaam_chat/src/logic/url_safety.dart';
import 'package:test/test.dart';

void main() {
  group('safeLinkUrl', () {
    test('accepts absolute http and https', () {
      expect(safeLinkUrl('https://example.com'), equals('https://example.com'));
      expect(safeLinkUrl('http://foo.test'), equals('http://foo.test'));
    });

    test('is case-insensitive about the scheme', () {
      expect(safeLinkUrl('HTTPS://example.com'), equals('HTTPS://example.com'));
      expect(safeLinkUrl('HtTp://foo.test'), equals('HtTp://foo.test'));
    });

    test('trims, and returns the trimmed value rather than the original', () {
      expect(safeLinkUrl('  https://example.com  '),
          equals('https://example.com'));
    });

    // The whole point of the allowlist. These are the schemes a link is
    // attacked with, and `linkify.test.ts` asserts the same four.
    test('refuses every non-http(s) scheme', () {
      for (final String url in <String>[
        'javascript:alert(1)',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        'ftp://example.com',
        'mailto:a@b.test',
        'tel:+15551234',
      ]) {
        expect(safeLinkUrl(url), isNull, reason: url);
      }
    });

    // NARROWER than `safeImageUrl`, on purpose — see the library doc. A
    // `data:image/svg+xml` is a picture in an <img> and a scriptable document
    // when navigated to, so the URL that will be OPENED gets no data: at all.
    test('refuses data: outright, including the image types safeImageUrl takes',
        () {
      for (final String url in <String>[
        'data:text/html;base64,PHNjcmlwdD4=',
        'data:image/svg+xml,<svg onload=alert(1)/>',
        'data:image/png;base64,iVBORw0KGgo=',
      ]) {
        expect(safeLinkUrl(url), isNull, reason: url);
      }
    });

    test('refuses a relative or schemeless URL', () {
      expect(safeLinkUrl('/help'), isNull);
      expect(safeLinkUrl('example.com'), isNull);
      // Protocol-relative resolves against the HOST page's scheme, which this
      // package does not choose.
      expect(safeLinkUrl('//example.com'), isNull);
    });

    // Anchored, so a scheme appearing later in the string cannot smuggle one
    // past the check.
    test('refuses a payload that merely CONTAINS an http scheme', () {
      expect(safeLinkUrl('javascript:void("https://example.com")'), isNull);
      expect(safeLinkUrl(' \n javascript:https://x'), isNull);
    });

    test('accepts null and empty as null, so an optional field gates directly',
        () {
      expect(safeLinkUrl(null), isNull);
      expect(safeLinkUrl(''), isNull);
      expect(safeLinkUrl('   '), isNull);
    });
  });
}
