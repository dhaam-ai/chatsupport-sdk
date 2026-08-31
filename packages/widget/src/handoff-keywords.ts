// `behaviour.handoffKeywords` — the words that take a visitor off the bot.
//
// Its own module, and a pure function, because the matching rule is the whole
// feature and it has exactly one trap worth isolating in a test.
//
// ── The trap: "urgent" contains "agent" ──────────────────────────────────
//
// The console's default keyword list is ["agent", "human", "person", "speak to
// someone"], and a naive `text.includes(keyword)` escalates on "urgent",
// "management", "personal" and "personally" — four words a support
// conversation is full of. That failure is silent and reads as the bot giving
// up at random, so the match is anchored to word boundaries instead.
//
// ── Why not `\b` ─────────────────────────────────────────────────────────
//
// `\b` is defined against `[A-Za-z0-9_]`, so it puts a boundary in the middle
// of "señor" and refuses one beside "日本語" — a customer typing a keyword in
// their own language would never match. The boundaries here are stated in
// terms of what a word CANNOT be adjacent to, using Unicode letter and number
// properties, so a keyword in any script behaves the same way.
//
// Phrases work by construction: "speak to someone" is matched with the same
// rule, its internal spaces included, because only the two ENDS are anchored.

/** Escapes a merchant-supplied string for use inside a regular expression. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The scripts that do not put spaces between words.
 *
 * A word boundary is not a universal idea — it is a property of scripts that
 * separate words in the first place. Japanese "担当者とお話ししたい" runs the
 * keyword 担当者 straight into と, which IS a letter, so a boundary rule would
 * refuse every keyword a Japanese, Chinese, Thai, Lao, Khmer or Burmese
 * merchant could possibly write.
 *
 * For these, substring matching is not a compromise — it is how matching in
 * these scripts is normally done, and the "urgent" contains "agent" trap that
 * motivates the boundary rule is specific to alphabetic scripts where short
 * words nest inside longer ones.
 */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * One keyword as a matcher.
 *
 * Lookaround rather than `\b`, and negated classes rather than positive ones,
 * so a keyword at the very start or end of the message still matches — there
 * is no character there to be "not a letter".
 *
 * Each END is decided independently, by the script of the character at that
 * end of the KEYWORD. A keyword is often mixed ("iPhoneサポート"), and the side
 * that needs a boundary should get one whatever the other side is doing.
 */
function matcher(keyword: string): RegExp {
  const escaped = escapeForRegExp(keyword);
  // Spread to CODE POINTS, not `charAt`: an emoji or a CJK character outside
  // the BMP is a surrogate pair, and indexing a string would hand the script
  // test half of one.
  const points = [...keyword];
  const first = points[0] ?? '';
  const last = points[points.length - 1] ?? '';
  const before = UNSPACED.test(first) ? '' : '(?<![\\p{L}\\p{N}])';
  const after = UNSPACED.test(last) ? '' : '(?![\\p{L}\\p{N}])';
  return new RegExp(`${before}${escaped}${after}`, 'iu');
}

/**
 * Whether a visitor's message asks for a person.
 *
 * `keywords` is expected already lower-cased and blank-free — that is
 * `parseHandoffKeywords`'s job, and doing it again here would be a second
 * opinion about the same question. The regexes are case-insensitive anyway,
 * because the visitor's own capitalisation is not the console's to normalise.
 *
 * An empty list matches nothing, which is what disables the feature for a
 * merchant who set no keywords.
 */
export function asksForAHuman(text: string, keywords: readonly string[]): boolean {
  if (keywords.length === 0) return false;
  const message = text.trim();
  if (message === '') return false;
  return keywords.some((keyword) => matcher(keyword).test(message));
}
