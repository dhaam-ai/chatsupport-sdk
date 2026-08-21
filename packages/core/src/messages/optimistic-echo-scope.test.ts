// The optimistic echo belongs to the session the send was COMPOSED in.
//
// `attachment-addressing.test.ts` pins the WIRE half: the frame is addressed
// to the session it was composed in, so the server can no longer file one
// conversation's file under another. This file pins the other half — the
// LOCAL one, which that fix did not touch.
//
// `#applyOutgoing` inserted the optimistic bubble into `ChatState.messages`
// and emitted `message` unconditionally, against whatever session happened to
// be on screen when the enqueue resolved. For `sendAttachment` that content is
// a signed storage URL belonging to the other conversation, so the customer
// looking at session B saw a private file from session A rendered in B's
// transcript, and every `message` subscriber was handed a row for a session
// they are not in. A privacy defect, not a cosmetic one.

import { describe, expect, it } from 'vitest';
import { FakeQueueTransport, SendQueue } from '../queue/index.js';
import type { QueuedSend } from '../queue/index.js';
import { ChatStore } from '../state/index.js';
import type { ChatMessage, ChatSession } from '../state/index.js';
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

const PRIVATE_URL = 'https://cdn.test/sess-A/medical-report.pdf';

/** An uploader that parks, so the session can be moved underneath it. */
function parkedUploader(url: string): {
  upload: () => Promise<{ url: string; mediaType: 'DOCUMENT' }>;
  release: () => void;
} {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    upload: async () => {
      await gate;
      return { url, mediaType: 'DOCUMENT' as const };
    },
    release: () => release(),
  };
}

async function harness(uploader: { upload: () => Promise<{ url: string; mediaType: 'DOCUMENT' }> }) {
  const store = new ChatStore();
  const transport = new FakeQueueTransport();
  const enqueued: QueuedSend[] = [];
  const emitted: ChatMessage[] = [];

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
  store.on('message', (message) => emitted.push(message));
  store.setState({ session: SESSION_A });
  return { store, controller, enqueued, emitted, queue };
}

describe('the optimistic echo is scoped to the session it was composed in', () => {
  it("never renders another conversation's attachment in the transcript on screen", async () => {
    const uploader = parkedUploader(PRIVATE_URL);
    const { store, controller, emitted } = await harness(uploader);

    const sending = controller.sendAttachment(new Blob(['x']), { fileName: 'report.pdf' });
    await Promise.resolve();

    // The switch lands while the upload is still in flight — the exact window
    // the wire-side fix was built for.
    store.setState({ session: SESSION_B, messages: [] });

    uploader.release();
    await sending;

    const messages = store.getState().messages;
    expect(messages.filter((row) => row.sessionId !== 'sess-B')).toEqual([]);
    expect(messages.map((row) => row.content)).not.toContain(PRIVATE_URL);

    // And no subscriber was handed a row for a session it is not in.
    expect(emitted.filter((row) => row.sessionId !== 'sess-B')).toEqual([]);
  });

  it('does not strand the suppressed send in the early-outcome map when it is acked', async () => {
    const uploader = parkedUploader(PRIVATE_URL);
    const { store, controller, emitted } = await harness(uploader);

    const acks: unknown[] = [];
    store.on('messageAck', (ack) => acks.push(ack));

    const sending = controller.sendAttachment(new Blob(['x']), { fileName: 'report.pdf' });
    await Promise.resolve();
    store.setState({ session: SESSION_B, messages: [] });
    uploader.release();
    await sending;

    // Whatever the queue reports about a send nobody can see must not queue up
    // forever waiting for a bubble that will never be inserted.
    expect(controller.settledEarlyCount).toBe(0);
    expect(acks).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('still renders and emits a send composed in the session on screen', async () => {
    const { store, controller, emitted } = await harness({
      upload: () => Promise.reject(new Error('unused')),
    });

    await controller.sendMessage('hello');

    expect(store.getState().messages.map((row) => row.content)).toEqual(['hello']);
    expect(emitted.map((row) => row.content)).toEqual(['hello']);
    expect(controller.settledEarlyCount).toBe(0);
  });
});
