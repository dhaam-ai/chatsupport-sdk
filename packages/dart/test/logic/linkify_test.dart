// Reproduces `packages/widget/test/linkify.test.ts` against the Dart port.
//
// One case there does NOT transfer: `does not leak the merchant's page URL to
// whatever was linked` asserts `rel="noopener noreferrer"` and
// `target="_blank"` on the built anchor. Those are properties of an HTML
// element, and `findLinks` builds none — the Flutter renderer that consumes
// these spans is where the equivalent decision (which is `url_launcher`'s
// external-application mode) gets made and tested.
//
// Everything else transfers, and the assertions stay weighted the same way:
// towards what must NEVER happen rather than towards matching cleverness.

import 'package:dhaam_chat/src/logic/linkify.dart';
import 'package:test/test.dart';

List<String> hrefs(String text) =>
    findLinks(text).map((TextLink l) => l.href).toList();

List<String> texts(String text) =>
    findLinks(text).map((TextLink l) => l.text).toList();

/// Rebuilds the message from the spans and the gaps between them.
///
/// The Dart-native form of the TypeScript's `node.textContent` assertions: if
/// this ever fails to equal the input, a renderer driven by these spans would
/// be showing the customer something other than what was written.
String reassemble(String text) {
  final StringBuffer out = StringBuffer();
  int cursor = 0;
  for (final TextLink link in findLinks(text)) {
    out.write(text.substring(cursor, link.start));
    out.write(link.text);
    cursor = link.end;
  }
  out.write(text.substring(cursor));
  return out.toString();
}

void main() {
  group('what must never happen', () {
    // On the web this guarded against `innerHTML`. Here it guards the same
    // outcome from the other side: markup in message text is not a link and
    // not a match, so nothing downstream is ever handed a span that would
    // make it interactive.
    test('never finds a link in markup, and leaves the text intact', () {
      const String text = '<img src=x onerror=alert(1)> and <b>bold</b>';
      expect(findLinks(text), isEmpty);
      expect(reassemble(text), equals(text));
    });

    test('never builds a link for a dangerous scheme', () {
      for (final String payload in <String>[
        'javascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
      ]) {
        final String text = 'click $payload now';
        expect(findLinks(text), isEmpty, reason: payload);
        // The text survives verbatim — it is simply not interactive.
        expect(reassemble(text), equals(text), reason: payload);
      }
    });

    // A link whose visible text disagrees with its destination is phishing,
    // and the text here is written by whoever is on the other end of the chat.
    test('shows exactly the text that was written, never a prettified version',
        () {
      const String url = 'https://example.com/a/very/long/path?x=1';
      final List<TextLink> links = findLinks('go to $url');
      expect(links, hasLength(1));
      expect(links.single.text, equals(url));
      expect(links.single.href, equals(url));
    });
  });

  group('what it matches', () {
    test('links absolute http(s) URLs', () {
      expect(
        hrefs('see https://example.com and http://foo.test'),
        equals(<String>['https://example.com', 'http://foo.test']),
      );
    });

    // People type these constantly and mean a link. Promoted to https rather
    // than left schemeless, which would resolve against something this
    // package did not choose.
    test('links a bare www. host, over https', () {
      expect(hrefs('visit www.example.com'),
          equals(<String>['https://www.example.com']));
      // …but the text the customer sees is still what they wrote.
      expect(
          texts('visit www.example.com'), equals(<String>['www.example.com']));
    });

    test('links email addresses as mailto:', () {
      expect(hrefs('write to help@example.com'),
          equals(<String>['mailto:help@example.com']));
      expect(texts('write to help@example.com'),
          equals(<String>['help@example.com']));
    });

    test('links several in one message, in order, keeping the text between',
        () {
      const String text = 'a https://one.test b help@two.test c';
      expect(
        hrefs(text),
        equals(<String>['https://one.test', 'mailto:help@two.test']),
      );
      expect(reassemble(text), equals(text));
    });
  });

  group('what it deliberately leaves alone', () {
    // Under-matching is the harmless direction: the text simply stays plain.
    // Over-matching produces links that go somewhere the sentence did not say.
    test('does not link a bare domain, a filename, or plain prose', () {
      for (final String text in <String>[
        'read faq.md for details',
        'open report.txt',
        'no links at all here',
      ]) {
        expect(findLinks(text), isEmpty, reason: text);
      }
    });

    test('leaves sentence punctuation out of the link', () {
      expect(hrefs('see https://example.com.'),
          equals(<String>['https://example.com']));
      expect(hrefs('see https://example.com, then'),
          equals(<String>['https://example.com']));
      // The full stop is still in the message, just not in the link.
      expect(reassemble('see https://example.com.'),
          equals('see https://example.com.'));
    });

    // Balanced brackets are legitimately part of a URL; an unmatched one
    // closed something in the sentence around it.
    test('keeps balanced brackets and drops unmatched ones', () {
      expect(
        hrefs('see https://example.com/a_(b)_c'),
        equals(<String>['https://example.com/a_(b)_c']),
      );
      expect(hrefs('(see https://example.com)'),
          equals(<String>['https://example.com']));
    });
  });

  group('findLinks', () {
    // The TypeScript patterns were module-level and global, so a stale
    // `lastIndex` made the second call skip the start of the string. Dart's
    // `allMatches` has no such cursor; the case is kept because the property
    // it pins — a pure function of its argument — is the one that matters.
    test('is not confused by being called twice', () {
      expect(findLinks('https://a.test'), hasLength(1));
      expect(findLinks('https://a.test'), hasLength(1));
    });

    test('never returns overlapping matches', () {
      final List<TextLink> links =
          findLinks('https://example.com/?to=help@example.com');
      for (int i = 1; i < links.length; i += 1) {
        expect(links[i].start, greaterThanOrEqualTo(links[i - 1].end));
      }
    });

    test('returns nothing for an empty string', () {
      expect(findLinks(''), isEmpty);
    });
  });
}
