import { describe, expect, it } from 'vitest';
import type { AttachmentMetadata } from '../protocol/index.js';
import { FakeQueueTransport, SendQueue } from '../queue/index.js';
import type { RecordedSend } from '../queue/index.js';
import { ChatStore } from '../state/index.js';
import type { ChatMessage, ChatSession } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { MessageController } from './controller.js';
import { NoActiveSessionError } from './types.js';

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

const PDF: AttachmentMetadata = {
  url: 'https://cdn.example.com/f/report.pdf',
  fileName: 'report.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  mediaType: 'DOCUMENT',
};

/** Stands in for a real `Blob`; core never inspects it. */
const FILE = { size: 2048, type: 'application/pdf' } as unknown as Blob;

interface Harness {
  readonly store: ChatStore;
  readonly controller: MessageController;
  readonly transport: FakeQueueTransport;
  readonly uploads: { sessionId: string; fileName?: string; file: Blob }[];
  readonly errors: unknown[];
  messages(): readonly ChatMessage[];
  settle(): Promise<void>;
}

async function harness(options: {
  session?: ChatSession | null;
  attachment?: AttachmentMetadata;
  fail?: boolean;
  hold?: boolean;
} = {}): Promise<Harness & { release: (value: AttachmentMetadata) => void }> {
  const store = new ChatStore();
  const transport = new FakeQueueTransport();
  const uploads: Harness['uploads'] = [];
  const errors: unknown[] = [];
  let release: (value: AttachmentMetadata) => void = () => {};

  store.on('error', (error) => errors.push(error));

  const controller: MessageController = new MessageController({
    store,
    enqueue: (sessionId, payload) => queue.enqueue(sessionId, payload),
    sender: () => ({ senderId: 'cust-1', senderType: 'CUSTOMER' }),
    history: { listMessages: () => Promise.resolve({ messages: [], hasMore: false }) },
    uploader: {
      upload: (request) => {
        uploads.push(request);
        if (options.fail) return Promise.reject(new Error('413 https://upload.example.com?sig=SECRET'));
        if (options.hold) return new Promise<AttachmentMetadata>((resolve) => { release = resolve; });
        return Promise.resolve(options.attachment ?? PDF);
      },
    },
  });

  const queue: SendQueue = new SendQueue({
    storage: new MemoryStorageAdapter(),
    transport,
    onAck: controller.onAck,
    onFailed: controller.onFailed,
  });
  await queue.restore();

  store.setState({ session: options.session === undefined ? SESSION : options.session });

  return {
    store,
    controller,
    transport,
    uploads,
    errors,
    messages: () => store.getState().messages,
    settle: () => queue.flush(),
    release: (value) => release(value),
  };
}

/** The one shape that matters: what actually went out on the wire. */
const sent = (transport: FakeQueueTransport): RecordedSend | undefined => transport.sends[0];

describe('sendAttachment — attachment is top-level, never nested (D4)', () => {
  it('puts the attachment at the top level of the wire payload', async () => {
    const h = await harness();

    await h.controller.sendAttachment(FILE);

    expect(sent(h.transport)?.payload.attachment).toEqual(PDF);
  });

  it('never writes the attachment under `metadata` on the wire', async () => {
    const h = await harness();

    await h.controller.sendAttachment(FILE);

    // v1 sent it top-level while the server read it nested, so attachments
    // vanished behind successful acks. Assert the absence explicitly.
    const payload = sent(h.transport)?.payload;
    expect(payload?.metadata).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('"metadata"');
  });

  it('keeps the attachment top-level even when the caller supplies metadata', async () => {
    const h = await harness();

    await h.controller.sendAttachment(FILE, { metadata: { source: 'drag-drop' } });

    const payload = sent(h.transport)?.payload;
    expect(payload?.attachment).toEqual(PDF);
    expect(payload?.metadata).toEqual({ source: 'drag-drop' });
    expect((payload?.metadata as Record<string, unknown>).attachment).toBeUndefined();
  });

  it('puts the attachment at the top level of the message in state', async () => {
    const h = await harness();

    await h.controller.sendAttachment(FILE);

    const message = h.messages()[0];
    expect(message?.attachment).toEqual(PDF);
    expect(message?.metadata).toBeUndefined();
  });

  it('survives the ack round trip still top-level', async () => {
    const h = await harness();
    h.transport.respondWith({
      status: 'acked',
      frame: { v: 1, t: 'ack', id: 'a', ref: 'r', ts: 0, d: { ok: true, seq: 3 } },
    });

    await h.controller.sendAttachment(FILE);
    await h.settle();

    const message = h.messages()[0];
    expect(message?.seq).toBe(3);
    expect(message?.delivery).toBeUndefined();
    expect(message?.attachment).toEqual(PDF);
    expect(JSON.stringify(message?.metadata ?? {})).not.toContain('cdn.example.com');
  });
});

describe('sendAttachment — upload-then-announce (§6.3, §12.10)', () => {
  it('uploads before queueing anything', async () => {
    const h = await harness({ hold: true });

    const pending = h.controller.sendAttachment(FILE);
    expect(h.uploads).toHaveLength(1);
    expect(h.transport.sends).toHaveLength(0);

    h.release(PDF);
    await pending;

    expect(h.transport.sends).toHaveLength(1);
  });

  it('passes the session and file name to the uploader', async () => {
    const h = await harness();

    await h.controller.sendAttachment(FILE, { fileName: 'renamed.pdf' });

    expect(h.uploads[0]?.sessionId).toBe('sess-1');
    expect(h.uploads[0]?.fileName).toBe('renamed.pdf');
    expect(h.uploads[0]?.file).toBe(FILE);
  });

  it('omits fileName rather than sending undefined when none is given', async () => {
    const h = await harness();

    await h.controller.sendAttachment(FILE);

    expect(h.uploads[0]).not.toHaveProperty('fileName');
  });

  it('sends the attachment URL as the message content (§12.10)', async () => {
    const h = await harness();

    await h.controller.sendAttachment(FILE);

    expect(sent(h.transport)?.payload.content).toBe(PDF.url);
  });

  it('is an ordinary optimistic send once queued', async () => {
    const h = await harness();
    h.transport.isOpen = false;

    await h.controller.sendAttachment(FILE);

    expect(h.messages()[0]?.delivery).toEqual({ state: 'queued' });
    expect(h.messages()[0]?.id).toBe(sent(h.transport)?.id ?? h.messages()[0]?.id);
  });

  it('throws when there is no active session', async () => {
    const h = await harness({ session: null });

    await expect(h.controller.sendAttachment(FILE)).rejects.toBeInstanceOf(NoActiveSessionError);
    expect(h.uploads).toHaveLength(0);
  });
});

describe('sendAttachment — message type from mediaType', () => {
  const cases: [string, string][] = [
    ['IMAGE', 'IMAGE'],
    ['VIDEO', 'VIDEO'],
    ['AUDIO', 'AUDIO'],
    ['DOCUMENT', 'FILE'],
    ['SOMETHING_NEW', 'FILE'],
  ];

  for (const [mediaType, expected] of cases) {
    it(`maps mediaType ${mediaType} to message type ${expected}`, async () => {
      const h = await harness({ attachment: { ...PDF, mediaType } });

      await h.controller.sendAttachment(FILE);

      expect(sent(h.transport)?.payload.type).toBe(expected);
    });
  }
});

describe('sendAttachment — uploading state (§6.4)', () => {
  it('sets uploading during the upload and clears it after', async () => {
    const h = await harness({ hold: true });

    const pending = h.controller.sendAttachment(FILE);
    expect(h.store.getState().uploading).toBe(true);

    h.release(PDF);
    await pending;

    expect(h.store.getState().uploading).toBe(false);
  });

  it('clears uploading when the upload fails', async () => {
    const h = await harness({ fail: true });

    await h.controller.sendAttachment(FILE);

    expect(h.store.getState().uploading).toBe(false);
  });

  it('stays true until the last concurrent upload finishes', async () => {
    const store = new ChatStore();
    const releases: ((value: AttachmentMetadata) => void)[] = [];

    const controller: MessageController = new MessageController({
      store,
      enqueue: (sessionId, payload) => queue.enqueue(sessionId, payload),
      sender: () => ({ senderId: 'c', senderType: 'CUSTOMER' }),
      history: { listMessages: () => Promise.resolve({ messages: [], hasMore: false }) },
      uploader: {
        upload: () => new Promise<AttachmentMetadata>((resolve) => releases.push(resolve)),
      },
    });
    const queue: SendQueue = new SendQueue({
      storage: new MemoryStorageAdapter(),
      transport: new FakeQueueTransport(),
      onAck: controller.onAck,
      onFailed: controller.onFailed,
    });
    await queue.restore();
    store.setState({ session: SESSION });

    const first = controller.sendAttachment(FILE);
    const second = controller.sendAttachment(FILE);
    expect(store.getState().uploading).toBe(true);

    releases[0]?.(PDF);
    await first;
    // The first upload finished, but the second is still going.
    expect(store.getState().uploading).toBe(true);

    releases[1]?.(PDF);
    await second;
    expect(store.getState().uploading).toBe(false);
  });
});

describe('sendAttachment — upload failure (§6.4, §6.5, §14)', () => {
  it('records lastError and emits `error` without rejecting', async () => {
    const h = await harness({ fail: true });

    await expect(h.controller.sendAttachment(FILE)).resolves.toBeUndefined();
    expect(h.store.getState().lastError?.message).toBe('attachment upload failed');
    expect(h.errors).toHaveLength(1);
  });

  it('queues nothing when the upload fails', async () => {
    const h = await harness({ fail: true });

    await h.controller.sendAttachment(FILE);

    expect(h.transport.sends).toHaveLength(0);
    expect(h.messages()).toHaveLength(0);
  });

  it('never copies the uploader error text into state (§14)', async () => {
    const h = await harness({ fail: true });

    await h.controller.sendAttachment(FILE);

    expect(JSON.stringify(h.store.getState().lastError)).not.toContain('SECRET');
    expect(JSON.stringify(h.store.getState().lastError)).not.toContain('sig=');
  });
});
