/// `behaviour.handoffKeywords` — the words that take a visitor off the bot.
///
/// Ports `packages/widget/src/handoff-keywords.ts`. Its own library, and a
/// pure function, because the matching rule is the whole feature and it has
/// exactly one trap worth isolating in a test.
///
/// ── The trap: "urgent" contains "agent" ──────────────────────────────────
///
/// The console's default keyword list is `["agent", "human", "person",
/// "speak to someone"]`, and a naive `text.contains(keyword)` escalates on
/// "urgent", "management", "personal" and "personally" — four words a support
/// conversation is full of. That failure is silent and reads as the bot giving
/// up at random, so the match is anchored to word boundaries instead.
///
/// ── Why not `\b` ─────────────────────────────────────────────────────────
///
/// `\b` is defined against `[A-Za-z0-9_]`, so it puts a boundary in the middle
/// of "señor" and refuses one beside "日本語" — a customer typing a keyword in
/// their own language would never match. The boundaries here are stated in
/// terms of what a word CANNOT be adjacent to, using Unicode letter and number
/// properties, so a keyword in any script behaves the same way.
///
/// Phrases work by construction: "speak to someone" is matched with the same
/// rule, its internal spaces included, because only the two ENDS are anchored.
///
/// ── Lookbehind on Dart 3.5.4 ─────────────────────────────────────────────
///
/// The anchors are real lookaround, exactly as in the TypeScript. Dart's
/// `RegExp` is backed by the same Irregexp engine V8 uses, and both
/// lookbehind and `\p{…}` property escapes under `unicode: true` were
/// verified to work on the pinned SDK before this was written — so the
/// fallback of inspecting code points adjacent to the match index by hand was
/// not needed, and its extra surface is not carried.
library;

/// The scripts that do not put spaces between words.
///
/// A word boundary is not a universal idea — it is a property of scripts that
/// separate words in the first place. Japanese "担当者とお話ししたい" runs the
/// keyword 担当者 straight into と, which IS a letter, so a boundary rule would
/// refuse every keyword a Japanese, Chinese, Thai, Lao, Khmer or Burmese
/// merchant could possibly write.
///
/// For these, substring matching is not a compromise — it is how matching in
/// these scripts is normally done, and the "urgent" contains "agent" trap that
/// motivates the boundary rule is specific to alphabetic scripts where short
/// words nest inside longer ones.
final RegExp _unspaced = RegExp(
  r'[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}'
  r'\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]',
  unicode: true,
);

/// One keyword as a matcher, or `null` for a keyword that cannot have one.
///
/// Lookaround rather than `\b`, and negated classes rather than positive ones,
/// so a keyword at the very start or end of the message still matches — there
/// is no character there to be "not a letter".
///
/// Each END is decided independently, by the script of the character at that
/// end of the KEYWORD. A keyword is often mixed ("iPhoneサポート"), and the side
/// that needs a boundary should get one whatever the other side is doing.
RegExp? _matcher(String keyword) {
  // Split to CODE POINTS, not UTF-16 units: an emoji or a CJK character
  // outside the BMP is a surrogate pair, and indexing the string would hand
  // the script test half of one.
  final List<int> points = keyword.runes.toList();
  // ── The one deliberate divergence from the TypeScript ──────────────────
  //
  // There, an empty keyword compiles to two anchors around nothing, which
  // matches at any position not between two letters — so a single blank entry
  // in the list escalates on "hi!". `parseHandoffKeywords` is documented to
  // strip blanks, so it never happens in practice; this refuses to build the
  // matcher anyway. That is not a second opinion about normalising the
  // merchant's input (which is the parser's job and is deliberately not
  // repeated here) — it is declining to emit a matcher that anchors nothing,
  // which no caller could ever want.
  if (points.isEmpty) return null;

  // `RegExp.escape` escapes exactly `( ) [ ] { } * + ? . ^ $ | \` — the same
  // set the TypeScript's hand-rolled character class covers, character for
  // character. A merchant-supplied string reaches a pattern compiler here, so
  // it has to be matched literally rather than compiled as a pattern, and
  // above all must not throw and take the send path down with it.
  final String escaped = RegExp.escape(keyword);
  final String first = String.fromCharCode(points.first);
  final String last = String.fromCharCode(points.last);
  final String before = _unspaced.hasMatch(first) ? '' : r'(?<![\p{L}\p{N}])';
  final String after = _unspaced.hasMatch(last) ? '' : r'(?![\p{L}\p{N}])';
  return RegExp(
    '$before$escaped$after',
    caseSensitive: false,
    unicode: true,
  );
}

/// Whether a visitor's message asks for a person.
///
/// [keywords] is expected already lower-cased and blank-free — that is the
/// config parser's job, and doing it again here would be a second opinion
/// about the same question. The matchers are case-insensitive anyway, because
/// the visitor's own capitalisation is not the console's to normalise.
///
/// An empty list matches nothing, which is what disables the feature for a
/// merchant who set no keywords. Matching everything there would escalate
/// every conversation on its first word — the worst possible reading of "not
/// configured".
bool asksForAHuman(String text, List<String> keywords) {
  if (keywords.isEmpty) return false;
  final String message = text.trim();
  if (message.isEmpty) return false;
  for (final String keyword in keywords) {
    final RegExp? matcher = _matcher(keyword);
    if (matcher != null && matcher.hasMatch(message)) return true;
  }
  return false;
}
