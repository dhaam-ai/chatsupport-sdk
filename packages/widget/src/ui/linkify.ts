// Turns URLs and email addresses in message text into real links.
//
// ── Why this is the most dangerous file in the package ───────────────────
//
// Everywhere else, message content goes through `textContent` with a comment
// saying "never innerHTML — this is another user's input". This module exists
// to make part of that string interactive, which means it is the one place
// where a decision is made about untrusted text becoming an element. So:
//
//   - It NEVER parses or assigns HTML. There is no `innerHTML`, no
//     `insertAdjacentHTML`, no template. It builds `<a>` and text nodes with
//     `document.createElement`/`createTextNode` and sets `textContent`.
//   - The href goes through `safeLinkUrl` (ui/dom.ts), the same allowlist the
//     branding link uses: absolute http(s) only, so `javascript:` and `data:`
//     are unreachable rather than merely unlikely.
//   - The link text is the matched substring itself, set as text. A link whose
//     visible text is attacker-chosen is a phishing surface, so nothing here
//     shortens, prettifies or rewrites what the customer sees — what is
//     written is what is shown.
//
// ── Deliberately conservative matching ───────────────────────────────────
//
// Not an RFC-complete URL parser, and not trying to be. It matches what people
// actually type in a support chat, and anything it declines to match simply
// stays plain text — which is the harmless outcome. A greedy pattern that
// swallowed trailing punctuation, or that matched a bare word with a dot in
// it, would be worse than under-matching: it would produce links that go
// somewhere other than where the sentence said.

import { safeLinkUrl } from './dom.js';

/**
 * Absolute http(s) URLs, and bare `www.` hosts.
 *
 * `www.` is included because people type it constantly and mean a link; a bare
 * `example.com` is NOT, because "contact support@ or read faq.md" would turn
 * a filename into a hyperlink.
 *
 * Brackets are ALLOWED through here and sorted out by {@link trimTrailing}
 * afterwards. Excluding them at the pattern level looks safer and is not: it
 * truncates `…/a_(b)_c` in the middle, producing a link that silently goes
 * somewhere other than what the sentence shows.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>{}"']+/gi;

/** Emails, matched separately so `mailto:` is built rather than guessed at. */
const EMAIL_PATTERN = /\b[^\s<>()[\]{}"'@]+@[^\s<>()[\]{}"'@.]+\.[^\s<>()[\]{}"'@.]{2,}\b/gi;

/**
 * Trailing characters that are almost always sentence punctuation rather than
 * part of the address.
 *
 * "see https://example.com." — the full stop ends the sentence, not the URL.
 * A closing bracket is trimmed only when unmatched, because Wikipedia-style
 * URLs legitimately contain balanced pairs.
 */
function trimTrailing(match: string): string {
  let end = match.length;
  while (end > 0) {
    const char = match[end - 1]!;
    if ('.,;:!?'.includes(char)) {
      end -= 1;
      continue;
    }
    if (char === ')' || char === ']') {
      const open = char === ')' ? '(' : '[';
      const slice = match.slice(0, end);
      // Balanced — the bracket belongs to the URL. Unbalanced — it closed
      // something in the sentence around it.
      const opens = slice.split(open).length - 1;
      const closes = slice.split(char).length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return match.slice(0, end);
}

interface Match {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly href: string;
}

/**
 * Every link in `text`, in order, non-overlapping.
 *
 * Exported for tests: the matching is the whole of the risk here, and it is a
 * pure function of the string.
 */
export function findLinks(text: string): readonly Match[] {
  const found: Match[] = [];

  for (const [pattern, kind] of [
    [URL_PATTERN, 'url'],
    [EMAIL_PATTERN, 'email'],
  ] as const) {
    // `lastIndex` is reset because these are module-level `g` regexes: a
    // previous call leaves it mid-string, and the second call would silently
    // skip the beginning of the next message.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = trimTrailing(match[0]);
      if (raw === '') continue;
      const start = match.index;
      const end = start + raw.length;

      // An email inside an already-matched URL (a `mailto:` in a query string,
      // say) must not become a second, nested link.
      if (found.some((f) => start < f.end && end > f.start)) continue;

      const href =
        kind === 'email'
          ? `mailto:${raw}`
          : (safeLinkUrl(raw) ?? safeLinkUrl(`https://${raw}`));
      // A `www.` host has no scheme, so it is promoted to https rather than
      // left for the browser to resolve against the HOST page's origin.
      if (href === null) continue;
      found.push({ start, end, text: raw, href });
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

/**
 * Fills `node` with `text`, linkifying what it can.
 *
 * Replaces the node's children outright, so it is safe to call on every
 * render — the caller compares the string first and skips when unchanged.
 */
export function renderLinkified(node: HTMLElement, text: string): void {
  const links = findLinks(text);
  if (links.length === 0) {
    node.textContent = text;
    return;
  }

  const parts: Node[] = [];
  let cursor = 0;
  for (const link of links) {
    if (link.start > cursor) parts.push(document.createTextNode(text.slice(cursor, link.start)));
    const anchor = document.createElement('a');
    anchor.className = 'dh-link';
    anchor.href = link.href;
    anchor.target = '_blank';
    // `noreferrer` alongside `noopener`: this runs on a merchant's checkout
    // page, and the referrer would leak that URL to whatever a customer or a
    // bot happened to link to.
    anchor.rel = 'noopener noreferrer';
    // The visible text is the matched substring, unmodified. See the header.
    anchor.textContent = link.text;
    parts.push(anchor);
    cursor = link.end;
  }
  if (cursor < text.length) parts.push(document.createTextNode(text.slice(cursor)));

  node.replaceChildren(...parts);
}
