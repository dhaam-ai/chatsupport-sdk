import { describe, expect, it } from 'vitest';
import type { MessagePayload } from '../protocol/index.js';
import { FakeQueueTransport, SendQueue } from '../queue/index.js';
import { ChatStore } from '../state/index.js';
import type { ChatMessage, ChatSession } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { MessageController } from './index.js';

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

function push(overrides: Partial<MessagePayload> & Pick<MessagePayload, 'id' | 'seq'>): MessagePayload {
  return {
    sessionId: 'sess-1',
    senderId: 'agent-1',
    senderType: 'AGENT',
    type: 'TEXT',
    content: 'from the agent',
    createdAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  };
}

interface Harness {
  readonly store: ChatStore;
  readonly controller: MessageController;
  readonly events: ChatMessage[];
  messages(): readonly ChatMessage[];
}

async function harness(): Promise<Harness> {
  const store = new ChatStore();
  const events: ChatMessage[] = [];
  store.on('message', (message) => events.push(message));

  const controller: MessageController = new MessageController({
    store,
    enqueue: (sessionId, payload) => queue.enqueue(sessionId, payload),
    sender: () => ({ senderId: 'cust-1', senderType: 'CUSTOMER' }),
    history: { listMessages: () => Promise.resolve({ messages: [], hasMore: false }) },
    uploader: { upload: () => Promise.reject(new Error('unused')) },
  });

  const queue: SendQueue = new SendQueue({
    storage: new MemoryStorageAdapter(),
    transport: new FakeQueueTransport(),
    onAck: controller.onAck,
    onFailed: controller.onFailed,
  });
  await queue.restore();
  store.setState({ session: SESSION });

  return { store, controller, events, messages: () => store.getState().messages };
}

const ids = (messages: readonly ChatMessage[]): string[] => messages.map((m) => m.id);

describe('applyIncoming — message.new (§6.5)', () => {
  it('adds the message and emits `message`', async () => {
    const h = await harness();

    h.controller.applyIncoming(push({ id: 'm1', seq: 1 }));

    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0]?.content).toBe('from the agent');
    expect(h.messages()[0]?.seq).toBe(1);
    expect(h.events).toHaveLength(1);
  });

  it('carries no delivery — an inbound message is server-confirmed by definition', async () => {
    const h = await harness();

    h.controller.applyIncoming(push({ id: 'm1', seq: 1 }));

    expect(h.messages()[0]?.delivery).toBeUndefined();
  });

  it('keeps an inbound attachment top-level, never under metadata (D4)', async () => {
    const h = await harness();
    const attachment = {
      url: 'https://cdn.example.com/f/1',
      fileName: 'a.png',
      mimeType: 'image/png',
      size: 10,
      mediaType: 'IMAGE',
    };

    h.controller.applyIncoming(push({ id: 'm1', seq: 1, type: 'IMAGE', attachment }));

    const message = h.messages()[0];
    expect(message?.attachment).toEqual(attachment);
    expect(message?.metadata).toBeUndefined();
  });
});

describe('applyIncoming — structural dedup on the ULID (§9.3, D1)', () => {
  it('yields one entry when the same message arrives twice', async () => {
    const h = await harness();
    const frame = push({ id: 'dup', seq: 5 });

    h.controller.applyIncoming(frame);
    h.controller.applyIncoming(frame);

    expect(h.messages()).toHaveLength(1);
  });

  it('emits `message` only once for a duplicate arrival', async () => {
    const h = await harness();
    const frame = push({ id: 'dup', seq: 5 });

    h.controller.applyIncoming(frame);
    h.controller.applyIncoming(frame);

    expect(h.events).toHaveLength(1);
  });

  it('preserves the identity of the entry already rendered', async () => {
    const h = await harness();

    h.controller.applyIncoming(push({ id: 'dup', seq: 5 }));
    const first = h.messages()[0];
    h.controller.applyIncoming(push({ id: 'dup', seq: 5, content: 'resent' }));

    expect(h.messages()[0]).toBe(first);
    expect(h.messages()[0]?.content).toBe('from the agent');
  });

  it('does not dedup two different ids that share content', async () => {
    // The inverse of v1's content-matching echo suppressor (§12.9).
    const h = await harness();

    h.controller.applyIncoming(push({ id: 'a', seq: 1, content: 'ok' }));
    h.controller.applyIncoming(push({ id: 'b', seq: 2, content: 'ok' }));

    expect(ids(h.messages())).toEqual(['a', 'b']);
  });

  it('does not disturb an in-flight optimistic send', async () => {
    const h = await harness();

    await h.controller.sendMessage('mine');
    const mineId = h.messages()[0]?.id ?? '';
    h.controller.applyIncoming(push({ id: 'theirs', seq: 1 }));

    expect(h.messages()).toHaveLength(2);
    // The confirmed message sorts ahead of the still-unconfirmed send.
    expect(ids(h.messages())).toEqual(['theirs', mineId]);
  });
});

describe('applyIncoming — ordering by seq, never ts (D2)', () => {
  it('orders by seq regardless of arrival order', async () => {
    const h = await harness();

    h.controller.applyIncoming(push({ id: 'c', seq: 3 }));
    h.controller.applyIncoming(push({ id: 'a', seq: 1 }));
    h.controller.applyIncoming(push({ id: 'b', seq: 2 }));

    expect(ids(h.messages())).toEqual(['a', 'b', 'c']);
  });

  it('ignores createdAt entirely when it disagrees with seq', async () => {
    const h = await harness();

    h.controller.applyIncoming(
      push({ id: 'first', seq: 1, createdAt: '2099-12-31T23:59:59.000Z' }),
    );
    h.controller.applyIncoming(
      push({ id: 'second', seq: 2, createdAt: '2000-01-01T00:00:00.000Z' }),
    );

    expect(ids(h.messages())).toEqual(['first', 'second']);
  });
});
