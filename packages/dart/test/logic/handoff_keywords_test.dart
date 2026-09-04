// Reproduces `packages/widget/test/handoff-keywords.test.ts` against the Dart
// port, case for case, plus the two cases the port's own divergences earn.

import 'package:dhaam_chat/src/logic/handoff_keywords.dart';
import 'package:test/test.dart';

/// The console's own shipped default list, lower-cased as the parser leaves it.
const List<String> defaults = <String>[
  'agent',
  'human',
  'person',
  'speak to someone',
];

void main() {
  group('asksForAHuman', () {
    test('escalates on a real request for a person', () {
      for (final String text in <String>[
        'I want to talk to an agent',
        'can I speak to a human',
        'get me a real person',
        'speak to someone please',
      ]) {
        expect(asksForAHuman(text, defaults), isTrue, reason: text);
      }
    });

    // THE trap this module exists for. A substring match on the console's own
    // default list escalates on all four of these, and a support conversation
    // is full of them — the bot would appear to give up at random.
    test('does not escalate on a word that merely CONTAINS a keyword', () {
      for (final String text in <String>[
        'this is urgent', // contains "agent"
        'escalate to management', // contains "agent"
        'this is a personal question', // contains "person"
        'I personally think so', // contains "person"
      ]) {
        expect(asksForAHuman(text, defaults), isFalse, reason: text);
      }
    });

    test('matches a keyword at the very start and very end', () {
      expect(asksForAHuman('agent', defaults), isTrue);
      expect(asksForAHuman('agent please', defaults), isTrue);
      expect(asksForAHuman('give me an agent', defaults), isTrue);
    });

    test('matches regardless of how the visitor capitalised it', () {
      expect(asksForAHuman('I need an AGENT', defaults), isTrue);
      expect(asksForAHuman('Human please', defaults), isTrue);
    });

    test('matches beside punctuation, which is not part of a word', () {
      expect(asksForAHuman('agent!', defaults), isTrue);
      expect(asksForAHuman('can I get an agent?', defaults), isTrue);
      expect(asksForAHuman('"human"', defaults), isTrue);
    });

    // `\b` is defined against [A-Za-z0-9_], so it would put a boundary inside
    // "señor" and refuse one beside "日本語" — a customer typing a keyword in
    // their own language would never match. These pin the Unicode behaviour.
    test('works for keywords outside the Latin alphabet', () {
      expect(asksForAHuman('quiero hablar con un asesor', <String>['asesor']),
          isTrue);
      expect(asksForAHuman('asesoramiento', <String>['asesor']), isFalse);
    });

    // The `\b` failure this port is explicitly built to avoid: a boundary
    // inside "señor". If the anchors ever regress to `\b`, this goes red.
    test('does not put a boundary inside an accented word', () {
      expect(asksForAHuman('hola señor', <String>['señor']), isTrue);
      expect(asksForAHuman('señores', <String>['señor']), isFalse);
    });

    // Japanese, Chinese, Thai and friends do not put spaces between words, so
    // the keyword runs straight into the next character — which IS a letter. A
    // boundary rule would refuse every keyword these merchants could write, so
    // those scripts match as substrings, which is how matching in them is
    // normally done anyway.
    test('matches an unspaced-script keyword with no spaces around it', () {
      expect(asksForAHuman('担当者とお話ししたい', <String>['担当者']), isTrue);
      expect(asksForAHuman('我想找人工客服帮忙', <String>['人工客服']), isTrue);
      expect(asksForAHuman('ฉันต้องการพนักงานตอนนี้', <String>['พนักงาน']),
          isTrue);
    });

    // Each end is decided by the script at that end of the KEYWORD, so a mixed
    // keyword still gets a boundary on the side that needs one.
    test('still guards the Latin end of a mixed-script keyword', () {
      expect(asksForAHuman('サポートJP へ', <String>['サポートJP']), isTrue);
      expect(asksForAHuman('サポートJPX', <String>['サポートJP']), isFalse);
    });

    test('treats a multi-word phrase as one unit', () {
      expect(
        asksForAHuman('let me speak to someone', <String>['speak to someone']),
        isTrue,
      );
      // The words are all present but not as the phrase.
      expect(
        asksForAHuman('speak to a someone', <String>['speak to someone']),
        isFalse,
      );
    });

    // An empty list is how a merchant who set no keywords disables the
    // feature. Matching everything there would escalate every conversation on
    // its first word — the worst possible reading of "not configured".
    test('matches nothing for an empty list or an empty message', () {
      expect(asksForAHuman('I need an agent', <String>[]), isFalse);
      expect(asksForAHuman('   ', defaults), isFalse);
    });

    // Merchant-supplied strings reach a pattern compiler, so a keyword full of
    // metacharacters has to be matched literally rather than compiled as a
    // pattern — and above all must not throw and take the send path with it.
    test('treats regex metacharacters in a keyword literally', () {
      expect(() => asksForAHuman('anything at all', <String>['a.*']),
          returnsNormally);
      expect(asksForAHuman('anything at all', <String>['a.*']), isFalse);
      expect(asksForAHuman('is this a.* thing', <String>['a.*']), isTrue);
      expect(() => asksForAHuman('mismatched (paren', <String>['(']),
          returnsNormally);
    });

    // ── The port's one deliberate divergence ────────────────────────────
    //
    // The TypeScript compiles an empty keyword to two anchors around nothing,
    // which matches at any position not between two letters — so one blank
    // entry escalates on "hi!". The parser is documented to strip blanks, so
    // it never happens in practice; this refuses to build the matcher anyway.
    test('a blank keyword in the list matches nothing rather than everything',
        () {
      expect(asksForAHuman('hi!', <String>['']), isFalse);
      expect(asksForAHuman('hi!', <String>['', 'agent']), isFalse);
      // …and a real keyword alongside it still works.
      expect(asksForAHuman('get me an agent!', <String>['', 'agent']), isTrue);
    });

    // Code points, not UTF-16 units: an astral first character must not have
    // its surrogate pair handed to the script test in halves.
    test('splits the keyword by code point, not by UTF-16 unit', () {
      // U+20BB7 is Han, beyond the BMP — so the leading anchor is dropped and
      // the keyword matches with a letter directly in front of it.
      expect(asksForAHuman('a\u{20BB7}b', <String>['\u{20BB7}']), isTrue);
      expect(() => asksForAHuman('\u{1F600}', <String>['\u{1F600}']),
          returnsNormally);
    });
  });
}
