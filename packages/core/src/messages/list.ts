// Message list algebra — PRD §9.2 (ordering), §9.3 (dedup), §6.3 (pagination).
//
// Two rules carry this module, and everything else follows from them:
//
//   1. `seq` is the ordering key — never the envelope's `ts`, never
//      `createdAt` (D2, §0.5). A clock the client does not control cannot be
//      an ordering key: two messages written in the same millisecond, or one
//      written by a machine whose clock is skewed, would order arbitrarily.
//   2. Identity is the ULID `id` — dedup is structural (D1, §0.5).
//
// v1's two dedup mechanisms are deliberately absent rather than ported: there
// is no `clientMessageId` ack-mapping table and no 10-second
// content-matching echo suppressor (§12.9). Under D1 a message's id never
// changes, so there is nothing to map and nothing to guess.

import type { ChatMessage } from '../state/index.js';

/**
 * Orders two messages by the §9.2/D2 rule.
 *
 * Server-confirmed messages sort by `seq` ascending. A message with no `seq`
 * is not yet confirmed (§6.4 — "absent `seq` means not yet server-confirmed")
 * and sorts *after* every confirmed one: it was written locally a moment ago,
 * so it belongs at the live end of the list.
 *
 * Two unconfirmed messages compare equal, which is exactly what preserves the
 * per-session FIFO order §9.2 guarantees — `Array.prototype.sort` is required
 * to be stable, so elements that compare equal keep their relative order.
 * Source: https://tc39.es/ecma262/#sec-array.prototype.sort
 * ("The sort is required to be stable (that is, elements that compare equal
 * must remain in their original order).")
 */
export function compareBySeq(a: ChatMessage, b: ChatMessage): number {
  if (a.seq === undefined && b.seq === undefined) return 0;
  if (a.seq === undefined) return 1;
  if (b.seq === undefined) return -1;
  return a.seq - b.seq;
}

/** A new array in §9.2 order. Never mutates its argument. */
export function sortMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages].sort(compareBySeq);
}

/**
 * Adds `message`, or replaces the entry that already carries its `id`.
 *
 * This is the whole of §9.3's dedup: the same message applied twice — a
 * replayed frame, a duplicated push — yields one entry, because the second
 * application lands on the first one's index rather than appending.
 */
export function upsertMessage(
  messages: readonly ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const index = messages.findIndex((existing) => existing.id === message.id);
  if (index < 0) return sortMessages([...messages, message]);

  const next = [...messages];
  next[index] = message;
  return next.sort(compareBySeq);
}

/**
 * Merges an older page in front of what is already loaded (§6.3, §12.10).
 *
 * Messages already present are skipped rather than replaced, so a page that
 * overlaps the live list does not hand a binding a brand-new object for a row
 * it is already rendering — list keys and memoized rows stay valid across a
 * `loadMore`. Returns the *same array reference* when the page adds nothing,
 * so a redundant page is a no-op all the way up through `ChatStore.setState`,
 * which compares by reference.
 */
export function prependPage(
  messages: ChatMessage[],
  page: readonly ChatMessage[],
): ChatMessage[] {
  const known = new Set(messages.map((message) => message.id));
  const additions = page.filter((message) => !known.has(message.id));
  if (additions.length === 0) return messages;

  return sortMessages([...additions, ...messages]);
}
