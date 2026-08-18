import { describe, expect, it } from 'vitest';
import { FakeQueueTransport, SendQueue } from '../queue/index.js';
import { ChatStore } from '../state/index.js';
import type { ChatMessage, ChatSession } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { MessageController } from './controller.js';
import { NoActiveSessionError } from './types.js';
import type { MessagePage } from './types.js';

const SESSION: ChatSession = {
  id: 'sess-1',
  status: 'OPEN',
  mode: 'BOT',
  createdAt: '2026-08-18T09:00:00.000Z',
  closedAt: null,
  assignedAgent: null,
  customer: null,
  ticket: null,
};

function message(id: string, seq: number | undefined, createdAt = '2026-08-18T10:00:00.000Z'): ChatMessage {
  return {
    id,
    sessionId: 'sess-1',
    senderId: 'agent-1',
    senderType: 'AGENT',
    type: 'TEXT',
    content: id,
    createdAt,
    ...(seq === undefined ? {} : { seq }),
  };
}

interface Harness {
  readonly store: ChatStore;
  readonly controller: MessageController;
  readonly queries: { sessionId: string; before?: string; limit: number }[];
  readonly errors: unknown[];
  messages(): readonly ChatMessage[];
}

async function harness(options: {
  session?: ChatSession | null;
  pages?: MessagePage[];
  fail?: boolean;
  pageSize?: number;
  seed?: ChatMessage[];
  hasMore?: boolean;
}): Promise<Harness> {
  const store = new ChatStore();
  const queries: Harness['queries'] = [];
  const errors: unknown[] = [];
  const pages = [...(options.pages ?? [])];

  store.on('error', (error) => errors.push(error));

  const controller: MessageController = new MessageController({
    store,
    enqueue: (sessionId, payload) => queue.enqueue(sessionId, payload),
    sender: () => ({ senderId: 'cust-1', senderType: 'CUSTOMER' }),
    history: {
      listMessages: (query) => {
        queries.push(query);
        if (options.fail) return Promise.reject(new Error('boom https://api.example.com?token=SECRET'));
        return Promise.resolve(pages.shift() ?? { messages: [], hasMore: false });
      },
    },
    uploader: { upload: () => Promise.reject(new Error('unused')) },
    ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
  });

  const queue: SendQueue = new SendQueue({
    storage: new MemoryStorageAdapter(),
    transport: new FakeQueueTransport(),
    onAck: controller.onAck,
    onFailed: controller.onFailed,
  });
  await queue.restore();

  store.setState({
    session: options.session === undefined ? SESSION : options.session,
    ...(options.seed === undefined ? {} : { messages: options.seed }),
    ...(options.hasMore === undefined ? {} : { pagination: { hasMore: options.hasMore, loadingMore: false } }),
  });

  return { store, controller, queries, errors, messages: () => store.getState().messages };
}

const ids = (messages: readonly ChatMessage[]): string[] => messages.map((m) => m.id);

describe('loadMore — backward cursor (§6.3, §12.10)', () => {
  it('requests the most recent page with no cursor when nothing is loaded', async () => {
    const h = await harness({ pages: [{ messages: [message('a', 1)], hasMore: false }] });

    await h.controller.loadMore();

    expect(h.queries).toEqual([{ sessionId: 'sess-1', limit: 20 }]);
    expect(h.queries[0]).not.toHaveProperty('before');
  });

  it('uses the oldest loaded message as the `before` cursor', async () => {
    const h = await harness({
      seed: [message('c', 3), message('d', 4)],
      hasMore: true,
      pages: [{ messages: [message('b', 2)], hasMore: true }],
    });

    await h.controller.loadMore();

    expect(h.queries[0]?.before).toBe('c');
  });

  it('honours a configured page size', async () => {
    const h = await harness({ pageSize: 50, pages: [{ messages: [], hasMore: false }] });

    await h.controller.loadMore();

    expect(h.queries[0]?.limit).toBe(50);
  });

  it('throws when there is no active session', async () => {
    const h = await harness({ session: null });
    await expect(h.controller.loadMore()).rejects.toBeInstanceOf(NoActiveSessionError);
  });
});

describe('loadMore — prepending (§9.2)', () => {
  it('prepends the page ahead of existing messages without reordering them', async () => {
    const h = await harness({
      seed: [message('c', 3), message('d', 4)],
      hasMore: true,
      pages: [{ messages: [message('a', 1), message('b', 2)], hasMore: false }],
    });

    await h.controller.loadMore();

    expect(ids(h.messages())).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves an unconfirmed send at the live end of the list', async () => {
    const pending: ChatMessage = { ...message('pending', undefined), delivery: { state: 'queued' } };
    const h = await harness({
      seed: [message('c', 3), pending],
      hasMore: true,
      pages: [{ messages: [message('a', 1)], hasMore: false }],
    });

    await h.controller.loadMore();

    expect(ids(h.messages())).toEqual(['a', 'c', 'pending']);
  });

  it('does not change identity of messages already loaded', async () => {
    const kept = message('c', 3);
    const h = await harness({
      seed: [kept],
      hasMore: true,
      pages: [{ messages: [message('a', 1)], hasMore: false }],
    });

    await h.controller.loadMore();

    expect(h.messages()[1]).toBe(kept);
  });

  it('yields one entry when a page overlaps what is already loaded', async () => {
    const h = await harness({
      seed: [message('b', 2), message('c', 3)],
      hasMore: true,
      pages: [{ messages: [message('a', 1), message('b', 2)], hasMore: false }],
    });

    await h.controller.loadMore();

    expect(ids(h.messages())).toEqual(['a', 'b', 'c']);
  });

  it('orders a page by seq even when its createdAt disagrees (D2)', async () => {
    const h = await harness({
      seed: [message('c', 3)],
      hasMore: true,
      pages: [
        {
          // Inverted timestamps: seq 1 claims the later clock reading.
          messages: [
            message('a', 1, '2099-01-01T00:00:00.000Z'),
            message('b', 2, '2000-01-01T00:00:00.000Z'),
          ],
          hasMore: false,
        },
      ],
    });

    await h.controller.loadMore();

    expect(ids(h.messages())).toEqual(['a', 'b', 'c']);
  });
});

describe('loadMore — pagination state (§6.4)', () => {
  it('records hasMore from the response', async () => {
    const h = await harness({ pages: [{ messages: [message('a', 1)], hasMore: true }] });

    await h.controller.loadMore();

    expect(h.store.getState().pagination).toEqual({ hasMore: true, loadingMore: false });
  });

  it('clears hasMore once the server says there is nothing older', async () => {
    const h = await harness({
      seed: [message('c', 3)],
      hasMore: true,
      pages: [{ messages: [message('a', 1)], hasMore: false }],
    });

    await h.controller.loadMore();

    expect(h.store.getState().pagination.hasMore).toBe(false);
  });

  it('sets loadingMore while the fetch is in flight and clears it after', async () => {
    const seen: boolean[] = [];
    const store = new ChatStore();
    let release: (page: MessagePage) => void = () => {};

    const controller = new MessageController({
      store,
      enqueue: () => Promise.reject(new Error('unused')),
      sender: () => ({ senderId: 'c', senderType: 'CUSTOMER' }),
      history: {
        listMessages: () => {
          seen.push(store.getState().pagination.loadingMore);
          return new Promise<MessagePage>((resolve) => {
            release = resolve;
          });
        },
      },
      uploader: { upload: () => Promise.reject(new Error('unused')) },
    });
    store.setState({ session: SESSION });

    const pending = controller.loadMore();
    release({ messages: [], hasMore: false });
    await pending;

    expect(seen).toEqual([true]);
    expect(store.getState().pagination.loadingMore).toBe(false);
  });

  it('does not fetch a second page while one is in flight', async () => {
    const h = await harness({ pages: [{ messages: [], hasMore: true }] });

    await Promise.all([h.controller.loadMore(), h.controller.loadMore()]);

    expect(h.queries).toHaveLength(1);
  });

  it('does not fetch when hasMore is false and messages are already loaded', async () => {
    const h = await harness({ seed: [message('a', 1)], hasMore: false });

    await h.controller.loadMore();

    expect(h.queries).toHaveLength(0);
  });

  it('still fetches the first page from a cold start, where hasMore defaults to false', async () => {
    const h = await harness({ pages: [{ messages: [message('a', 1)], hasMore: true }] });

    await h.controller.loadMore();

    expect(h.queries).toHaveLength(1);
    expect(ids(h.messages())).toEqual(['a']);
  });
});

describe('loadMore — failure (§6.4, §6.5, §14)', () => {
  it('does not reject; it records lastError and emits `error`', async () => {
    const h = await harness({ fail: true });

    await expect(h.controller.loadMore()).resolves.toBeUndefined();
    expect(h.store.getState().lastError).toEqual({
      source: 'transport',
      code: null,
      message: 'failed to load message history',
      retryable: true,
    });
    expect(h.errors).toHaveLength(1);
  });

  it('clears loadingMore so a retry is possible', async () => {
    const h = await harness({ fail: true });

    await h.controller.loadMore();

    expect(h.store.getState().pagination.loadingMore).toBe(false);
  });

  it('never copies the adapter error text into state (§14)', async () => {
    const h = await harness({ fail: true });

    await h.controller.loadMore();

    // The adapter's message carried a tokenized URL. None of it may reach
    // observable state, where a binding would happily render it.
    expect(JSON.stringify(h.store.getState().lastError)).not.toContain('SECRET');
    expect(JSON.stringify(h.store.getState().lastError)).not.toContain('token');
  });

  it('leaves already-loaded messages untouched', async () => {
    const h = await harness({ fail: true, seed: [message('a', 1)], hasMore: true });

    await h.controller.loadMore();

    expect(ids(h.messages())).toEqual(['a']);
  });
});

describe('loadMore — live messages during a fetch', () => {
  it('does not drop a message that arrived while the page was loading', async () => {
    const store = new ChatStore();
    let release: (page: MessagePage) => void = () => {};

    const controller = new MessageController({
      store,
      enqueue: () => Promise.reject(new Error('unused')),
      sender: () => ({ senderId: 'c', senderType: 'CUSTOMER' }),
      history: {
        listMessages: () =>
          new Promise<MessagePage>((resolve) => {
            release = resolve;
          }),
      },
      uploader: { upload: () => Promise.reject(new Error('unused')) },
    });
    store.setState({ session: SESSION, messages: [message('c', 3)], pagination: { hasMore: true, loadingMore: false } });

    const pending = controller.loadMore();
    // A live `message.new` lands mid-fetch.
    store.setState({ messages: [message('c', 3), message('live', 4)] });
    release({ messages: [message('a', 1)], hasMore: false });
    await pending;

    expect(ids(store.getState().messages)).toEqual(['a', 'c', 'live']);
  });
});

describe('loadMore — no forward cursor exists', () => {
  it('never sends an `after` parameter', async () => {
    const h = await harness({ pages: [{ messages: [], hasMore: false }] });

    await h.controller.loadMore();

    expect(h.queries[0]).not.toHaveProperty('after');
  });
});
