// A send is addressed to the session it was COMPOSED in — not to whichever
// session happens to be joined when it finally goes out.
//
// `sendAttachment` is the send path with a network round trip sitting between
// "which session is this for" and the send itself: it uploads the file, awaits
// the uploader, and only then enqueues. A session switch landing inside that
// window used to produce a frame whose CONTENT was session A's storage URL and
// whose DESTINATION was session B — the server authorizes it (the customer
// owns B), files it under B, and broadcasts it to B's agent. One of the
// customer's own conversations leaking into another.
//
// These tests pin the fix at its widest window. `sendMessage` reads the
// session synchronously in the same tick, so it cannot drift this way; it is
// covered here anyway because the addressing now runs through one shared path
// and a regression would take both.

import { describe, expect, it } from 'vitest';
import { FakeQueueTransport, SendQueue } from '../queue/index.js';
import type { QueuedSend } from '../queue/index.js';
import { ChatStore } from '../state/index.js';
import type { ChatSession } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { MessageController } from './controller.js';

const SESSION_A: ChatSession = {
  id: 'sess-A',
  status: 'OPEN',
  mode: 'BOT',
  createdAt: '2026-08-18T09:00:00.000Z',
  closedAt: null,
  assignedAgent: null,
  customer: null,
  ticket: null,
};

const SESSION_B: ChatSession = { ...SESSION_A, id: 'sess-B' };

/**
 * An uploader that parks, so the test controls exactly when the round trip
 * completes and can move the session underneath it.
 */
function parkedUploader(url: string): {
  upload: () => Promise<{ url: string; mediaType: 'DOCUMENT' }>;
  release: () => void;
  started: () => boolean;
} {
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    upload: async () => {
      started = true;
      await gate;
      return { url, mediaType: 'DOCUMENT' as const };
    },
    release: () => release(),
    started: () => started,
  };
}

async function harness(uploader: { upload: () => Promise<{ url: string; mediaType: 'DOCUMENT' }> }) {
  const store = new ChatStore();
  const transport = new FakeQueueTransport();
  const enqueued: QueuedSend[] = [];

  const controller: MessageController = new MessageController({
    store,
    enqueue: async (sessionId, payload) => {
      const entry = await queue.enqueue(sessionId, payload);
      enqueued.push(entry);
      return entry;
    },
    sender: () => ({ senderId: 'cust-1', senderType: 'CUSTOMER' }),
    history: { listMessages: () => Promise.resolve({ messages: [], hasMore: false }) },
    uploader: uploader as never,
  });

  const queue: SendQueue = new SendQueue({
    storage: new MemoryStorageAdapter(),
    transport,
    onAck: controller.onAck,
    onFailed: controller.onFailed,
  });

  await queue.restore();
  store.setState({ session: SESSION_A });
  return { store, controller, enqueued };
}

describe('a send is addressed to the session it was composed in', () => {
  it('files an attachment under the session it was uploaded for, even if the session switched mid-upload', async () => {
    const uploader = parkedUploader('https://cdn.test/sess-A/invoice.pdf');
    const { store, controller, enqueued } = await harness(uploader);

    const sending = controller.sendAttachment(new Blob(['x']), { fileName: 'invoice.pdf' });
    await Promise.resolve();
    expect(uploader.started()).toBe(true);

    // The switch lands while the upload is still in flight. This is the exact
    // window that produced the leak.
    store.setState({ session: SESSION_B });

    uploader.release();
    await sending;

    expect(enqueued).toHaveLength(1);
    const entry = enqueued[0]!;

    // Queued under A — not under whatever was current when the upload landed.
    expect(entry.sessionId).toBe('sess-A');

    // And addressed to A ON THE WIRE. Without this the server attributes the
    // frame to the connection's last `session.join`, which is B.
    expect(entry.payload.sessionId).toBe('sess-A');

    // The content is A's storage path; content and destination must agree.
    expect(entry.payload.content).toBe('https://cdn.test/sess-A/invoice.pdf');
  });

  it('addresses an ordinary text send to the current session', async () => {
    const { controller, enqueued } = await harness({
      upload: () => Promise.reject(new Error('unused')),
    });

    await controller.sendMessage('hello');

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.sessionId).toBe('sess-A');
    expect(enqueued[0]!.payload.sessionId).toBe('sess-A');
  });
});
