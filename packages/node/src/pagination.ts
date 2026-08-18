// Async-iterable pagination over the cursor shapes.
//
// The point is that a customer writes
//
//   for await (const message of chat.asUser(token).messages(sessionId)) { … }
//
// instead of hand-rolling a `before`/`hasMore` loop. Hand-rolled versions get
// two things wrong, reliably: they forget that `hasMore` and "the page came
// back empty" are different conditions, and they take the cursor from the
// wrong end of the page. Both produce an infinite loop against a live API.
//
// ── The cursor model (OpenAPI `listSessionMessages`) ─────────────────────
//
// Backward-only. `before` is an opaque message id; the response is the page
// immediately PRECEDING it, in ASCENDING chronological order (oldest first),
// with a `hasMore` boolean. Omit `before` for the most recent page. There is
// no forward cursor — live messages arrive over the WebSocket, not by polling.
//
// So the next cursor is the id of the OLDEST message in the current page,
// which — because the page is ascending — is `messages[0]`, not the last
// element. Taking the last element instead walks forward into the page just
// returned and never terminates.

import type { HttpClient } from './http.js';
import type { ChatMessage, MessagePage } from './types.js';

/** One page of a cursor-paginated collection, normalized across endpoints. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
}

/** Fetches the page preceding `cursor`; `undefined` means the most recent page. */
export type PageFetcher<T> = (cursor: string | undefined) => Promise<Page<T>>;

/** Derives the cursor for the NEXT request from the page just received. */
export type CursorOf<T> = (page: Page<T>) => string | undefined;

export interface PaginateOptions {
  /**
   * Stop after this many pages.
   *
   * Not a safety net — {@link paginate} terminates on its own — but a bound
   * for callers walking a history of unknown size who would rather stop than
   * pull a million messages into memory.
   */
  readonly maxPages?: number;
}

/**
 * Walk a cursor-paginated collection page by page.
 *
 * Generic over the page shape so the same termination logic serves every
 * endpoint. Everything that has ever gone wrong with this loop is handled in
 * one place rather than once per call site.
 *
 * Termination is guaranteed by THREE independent conditions, because relying
 * on `hasMore` alone means trusting a remote server to end your loop:
 *
 *  1. `hasMore === false` — the normal case.
 *  2. An empty page. A server answering `{ items: [], hasMore: true }` — a bug,
 *     but a bug that has shipped in real APIs — would otherwise spin forever
 *     re-requesting the same cursor. There is nothing to advance the cursor
 *     WITH, so continuing cannot make progress by construction.
 *  3. A cursor that did not change. If the derived cursor equals the one just
 *     used, the next request is identical to the last and the loop is not
 *     advancing. This is the condition that catches a malformed page whose
 *     first item lacks an id.
 */
export async function* paginate<T>(
  fetchPage: PageFetcher<T>,
  cursorOf: CursorOf<T>,
  options: PaginateOptions = {},
): AsyncGenerator<Page<T>, void, undefined> {
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  if (maxPages < 1) return;

  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    const page = await fetchPage(cursor);
    yield page;
    pages += 1;

    if (!page.hasMore) return;
    if (page.items.length === 0) return;
    if (pages >= maxPages) return;

    const next = cursorOf(page);
    if (next === undefined || next === cursor) return;
    cursor = next;
  }
}

/** Flatten an async-iterable of pages into an async-iterable of items. */
export async function* flatten<T>(
  pages: AsyncIterable<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  for await (const page of pages) {
    for (const item of page.items) yield item;
  }
}

export interface ListMessagesOptions extends PaginateOptions {
  /** Page size, 1-100. The server defaults to 20. */
  readonly limit?: number;
  /** Start from the page preceding this message id, rather than the most recent page. */
  readonly before?: string;
}

/**
 * Page through a session's message history, newest page first.
 *
 * Each yielded page is in ascending chronological order (oldest first), which
 * is what lets a UI prepend it to an existing list without re-sorting; the
 * PAGES themselves walk backward through history.
 */
export function listMessagePages(
  http: HttpClient,
  sessionId: string,
  options: ListMessagesOptions = {},
): AsyncGenerator<Page<ChatMessage>, void, undefined> {
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new Error('sessionId is required');
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)) {
    // Bounded by the OpenAPI `LimitQuery` schema. Caught here so the failure
    // names the constraint rather than arriving as a generic 400.
    throw new Error('limit must be an integer between 1 and 100');
  }

  const path = `/sessions/${encodeURIComponent(sessionId)}/messages`;

  const fetchPage: PageFetcher<ChatMessage> = async (cursor) => {
    const wire = await http.request<MessagePage>('GET', path, {
      query: {
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(cursor === undefined ? {} : { before: cursor }),
      },
    });

    // Narrowed defensively. A proxy returning an error page with a 200, or a
    // server whose envelope differs from the contract, would otherwise make
    // `wire.messages` undefined and turn the loop below into a TypeError
    // several frames away from the cause.
    if (typeof wire !== 'object' || wire === null || !Array.isArray(wire.messages)) {
      throw new Error(
        `the messages endpoint returned a body that is not a { messages, hasMore } page. ` +
          `Check that apiUrl points at chat-service.`,
      );
    }
    return { items: wire.messages, hasMore: wire.hasMore === true };
  };

  // The cursor is the OLDEST message — `items[0]`, because pages are ascending.
  // Reading `items[items.length - 1]` here is the classic version of this bug:
  // it re-requests the page just returned, forever.
  const cursorOf: CursorOf<ChatMessage> = (page) => page.items[0]?.id;

  const first = options.before;
  if (first === undefined) return paginate(fetchPage, cursorOf, options);

  // A caller-supplied starting cursor. Threaded by wrapping the fetcher rather
  // than by seeding `paginate`'s internal state, so `paginate` keeps exactly
  // one notion of where the cursor comes from.
  let used = false;
  const seeded: PageFetcher<ChatMessage> = (cursor) => {
    if (!used && cursor === undefined) {
      used = true;
      return fetchPage(first);
    }
    return fetchPage(cursor);
  };
  return paginate(seeded, cursorOf, options);
}

/**
 * Every message in a session, oldest-page-last.
 *
 * Convenience over {@link listMessagePages} for callers who do not care about
 * page boundaries.
 */
export function listMessages(
  http: HttpClient,
  sessionId: string,
  options: ListMessagesOptions = {},
): AsyncGenerator<ChatMessage, void, undefined> {
  return flatten(listMessagePages(http, sessionId, options));
}
