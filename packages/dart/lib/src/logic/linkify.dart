/// Finds the URLs and email addresses in message text.
///
/// Ports the pure half of `packages/widget/src/ui/linkify.ts`. The rendering
/// half does not come with it: on the web it existed to build `<a>` elements
/// with `createElement`/`createTextNode` instead of `innerHTML`, and a Flutter
/// host has no such hazard to guard against — a `TextSpan` is never parsed as
/// markup. What survives the port is the part that was ever risky, which is
/// deciding WHICH substrings become links and WHERE they point.
///
/// ── The two rules a caller must not undo ─────────────────────────────────
///
///  1. [TextLink.text] is the matched substring VERBATIM. A link whose visible
///     text disagrees with its destination is a phishing surface, and this
///     text was written by whoever is on the other end of the chat. Nothing
///     here shortens, prettifies or rewrites it, and a renderer must not
///     either.
///  2. [TextLink.href] has already been through
///     [safeLinkUrl] — absolute http(s) only. A match whose href would be
///     anything else is dropped rather than rendered inert, so a renderer
///     never has to make that judgement a second time.
///
/// ── Deliberately conservative matching ───────────────────────────────────
///
/// Not an RFC-complete URL parser and not trying to be. It matches what people
/// actually type into a support chat, and anything it declines simply stays
/// plain text — the harmless outcome. Over-matching is the dangerous
/// direction: a greedy pattern that swallowed trailing punctuation, or that
/// linked any bare word with a dot in it, produces links that go somewhere
/// other than what the sentence said.
library;

import 'url_safety.dart';

/// One link found in a message, as a span over the ORIGINAL string.
///
/// [start] and [end] are UTF-16 offsets into the text that was searched, so a
/// renderer can slice the untouched original around them rather than
/// reassembling it from pieces.
class TextLink {
  const TextLink({
    required this.start,
    required this.end,
    required this.text,
    required this.href,
  });

  /// Inclusive UTF-16 offset of the first character of the link.
  final int start;

  /// Exclusive UTF-16 offset just past the last character of the link.
  final int end;

  /// The matched substring, unmodified. This is what the customer must see.
  final String text;

  /// Where it points. Always absolute http(s), or a `mailto:`.
  final String href;

  @override
  bool operator ==(Object other) =>
      other is TextLink &&
      other.start == start &&
      other.end == end &&
      other.text == text &&
      other.href == href;

  @override
  int get hashCode => Object.hash(start, end, text, href);

  @override
  String toString() => 'TextLink($start..$end, "$text" -> $href)';
}

/// Absolute http(s) URLs, and bare `www.` hosts.
///
/// `www.` is included because people type it constantly and mean a link. A
/// bare `example.com` is NOT, because "read faq.md for details" would turn a
/// filename into a hyperlink.
///
/// Brackets are ALLOWED through here and sorted out by [_trimTrailing]
/// afterwards. Excluding them at the pattern level looks safer and is not: it
/// truncates `…/a_(b)_c` in the middle, producing a link that silently goes
/// somewhere other than what the sentence shows.
final RegExp _urlPattern = RegExp(
  r'''\b(?:https?://|www\.)[^\s<>{}"']+''',
  caseSensitive: false,
);

/// Emails, matched separately so `mailto:` is BUILT rather than guessed at.
final RegExp _emailPattern = RegExp(
  r'''\b[^\s<>()[\]{}"'@]+@[^\s<>()[\]{}"'@.]+\.[^\s<>()[\]{}"'@.]{2,}\b''',
  caseSensitive: false,
);

/// Every link in [text], in order, non-overlapping.
///
/// Returns an unmodifiable list; an empty string yields an empty one.
List<TextLink> findLinks(String text) {
  final List<TextLink> found = <TextLink>[];
  // URLs FIRST, and the order is load-bearing: the overlap rule below drops
  // whichever match arrives second, and an email inside a URL's query string
  // (`?to=help@example.com`) must lose to the URL that contains it rather
  // than carve a nested link out of the middle of one.
  _collect(text, _urlPattern, isEmail: false, into: found);
  _collect(text, _emailPattern, isEmail: true, into: found);
  // Distinct starts by construction — two matches sharing one would overlap,
  // and the second would have been dropped — so no stability question arises.
  found.sort((TextLink a, TextLink b) => a.start.compareTo(b.start));
  return List<TextLink>.unmodifiable(found);
}

void _collect(
  String text,
  RegExp pattern, {
  required bool isEmail,
  required List<TextLink> into,
}) {
  // `allMatches` is a fresh iteration each call, so the TypeScript original's
  // `pattern.lastIndex = 0` has no counterpart here: there is no cursor on a
  // Dart `RegExp` for a previous call to leave mid-string.
  for (final RegExpMatch match in pattern.allMatches(text)) {
    final String raw = _trimTrailing(match[0]!);
    if (raw.isEmpty) continue;
    final int start = match.start;
    final int end = start + raw.length;

    if (into.any((TextLink f) => start < f.end && end > f.start)) continue;

    final String? href = isEmail
        ? 'mailto:$raw'
        // A `www.` host has no scheme, so it is promoted to https rather than
        // left for the platform to resolve against something this package did
        // not choose. `safeLinkUrl` is the SECOND gate, not the first — the
        // pattern above already admits only http(s) and `www.` — and it stays
        // because a URL that reaches a browser should have passed the
        // allowlist on the way, not merely have been unable to fail it.
        : safeLinkUrl(raw) ?? safeLinkUrl('https://$raw');
    if (href == null) continue;

    into.add(TextLink(start: start, end: end, text: raw, href: href));
  }
}

/// Strips the trailing characters that are sentence punctuation rather than
/// part of the address.
///
/// "see https://example.com." — the full stop ends the sentence, not the URL.
///
/// A closing bracket is trimmed ONLY when unmatched, because Wikipedia-style
/// URLs legitimately contain balanced pairs. `…/a_(b)_c` keeps its brackets;
/// the `)` in "(see https://example.com)" closed something in the sentence
/// around the link and is dropped.
String _trimTrailing(String match) {
  int end = match.length;
  while (end > 0) {
    // Single UTF-16 code unit, exactly as the TypeScript indexes it. Every
    // character this function acts on is ASCII, so no astral pair is ever
    // split by looking at one.
    final String char = match[end - 1];
    if ('.,;:!?'.contains(char)) {
      end -= 1;
      continue;
    }
    if (char == ')' || char == ']') {
      final String open = char == ')' ? '(' : '[';
      final String slice = match.substring(0, end);
      if (_count(slice, char) > _count(slice, open)) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return match.substring(0, end);
}

int _count(String haystack, String needle) => haystack.split(needle).length - 1;
