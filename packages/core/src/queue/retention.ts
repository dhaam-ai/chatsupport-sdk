// The §9.6 retention bound, as a pure function.
//
// "Bounded age/size before a queued send is surfaced as permanently failed
// rather than retried forever in silence." Both halves are here, side by side
// and side-effect-free, so the policy can be argued with in a test without
// standing up storage, a transport, or a clock.
//
// Applied in three places, which is the reason it is worth extracting: on
// restore (an entry that aged out while the tab was closed must fail at boot,
// not be delivered a day late), on enqueue (the size bound), and before every
// delivery attempt (the age bound, since time passes while offline).

import type { QueuedSend, SendQueueRetention } from './types.js';
import { DEFAULT_MAX_AGE_MS, DEFAULT_MAX_ENTRIES } from './types.js';

/** Retention with every default filled in. */
export interface ResolvedRetention {
  readonly maxAgeMs: number;
  readonly maxEntries: number;
}

export function resolveRetention(retention: SendQueueRetention = {}): ResolvedRetention {
  return {
    maxAgeMs: retention.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    maxEntries: retention.maxEntries ?? DEFAULT_MAX_ENTRIES,
  };
}

/** How a set of entries divides once the bound is applied. */
export interface RetentionSplit {
  /** Entries still eligible for delivery, in their original order. */
  readonly kept: QueuedSend[];

  /** Entries that outlived `maxAgeMs`. */
  readonly expired: QueuedSend[];

  /** Entries dropped to fit `maxEntries`, oldest first. */
  readonly evicted: QueuedSend[];
}

/**
 * Splits `entries` into what survives the retention bound and what does not.
 *
 * Age is applied before size, deliberately: an entry that has already aged out
 * is dead regardless, so expiring it first may free enough room that nothing
 * healthy has to be evicted. Doing it the other way round could evict a fresh
 * message to make space for one that was about to be discarded anyway.
 *
 * Both overflow paths drop the *oldest* first, matching the order the queue
 * stores entries in (insertion order across all sessions). Per-session FIFO is
 * unaffected: removing the globally-oldest entries preserves the relative
 * order of everything that remains, within every session.
 */
export function applyRetention(
  entries: readonly QueuedSend[],
  now: number,
  retention: ResolvedRetention,
): RetentionSplit {
  const expired: QueuedSend[] = [];
  const fresh: QueuedSend[] = [];

  for (const entry of entries) {
    if (now - entry.enqueuedAt > retention.maxAgeMs) {
      expired.push(entry);
    } else {
      fresh.push(entry);
    }
  }

  const overflow = Math.max(0, fresh.length - retention.maxEntries);
  const evicted = fresh.slice(0, overflow);
  const kept = fresh.slice(overflow);

  return { kept, expired, evicted };
}
