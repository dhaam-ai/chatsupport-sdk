import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnyFrame, ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import { generateUlid } from '../ulid.js';
import { createInitialChatState, ChatStateStore } from '../state/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { SendQueue } from '../queue/index.js';
import { MockWebSocket } from '../../test/mock-websocket.js';
import { Transport } from '../transport/index.js';
import { ConnectionMachine } from '../connection/index.js';
import { MessageCoordinator } from './message-coordinator.js';
import { RestClient } from './rest-client.js';

function sessionSnapshot(): SessionSnapshot {
  return { sessionId: 's1', status: 'OPEN', mode: 'BOT', participants: [], createdAt: '2026-01-01T00:00:00.000Z' };
}

function ackFrame(overrides: Partial<ConnectionAckPayload> = {}): AnyFrame {
  return { v: 1, t: 'connection.ack', id: generateUlid(), ts: Date.now(), d: { protocolVersion: 1, session: sessionSnapshot(), seq: 1, ...overrides } };
}

function messageNewFrame(overrides: Record<string, unknown> = {}): AnyFrame {
  return {
    v: 1,
    t: 'message.new',
    id: generateUlid(),
    ts: Date.now(),
    d: {
      id: generateUlid(),
      sessionId: 's1',
      senderId: 'agent-1',
      senderType: 'AGENT',
      type: 'TEXT',
      content: 'hi there',
      seq: 2,
      createdAt: '2026-01-01T00:00:01.000Z',
      ...overrides,
    },
  };
}

function ackFor(ref: string): AnyFrame {
  return { v: 1, t: 'ack', id: generateUlid(), ref, ts: Date.now(), d: { ok: true, seq: 2 } } as AnyFrame;
}

describe('MessageCoordinator', () => {
  let sockets: MockWebSocket[];
  let transport: Transport;
  let connection: ConnectionMachine;
  let store: ChatStateStore;
  let sendQueue: SendQueue;
  let coordinator: MessageCoordinator;
  let fetchImpl: ReturnType<typeof vi.fn>;

  function currentSocket(): MockWebSocket {
    const socket = sockets[sockets.length - 1];
    if (!socket) throw new Error('no socket yet');
    return socket;
  }

  function sentFrames(): Array<{ t: string; id: string; d: Record<string, unknown> }> {
    return currentSocket().sent.map((s) => JSON.parse(s));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    transport = new Transport({
      webSocketFactory: () => {
        const socket = new MockWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
    connection = new ConnectionMachine({
      url: 'ws://example.invalid',
      transport,
      buildHello: async () => ({ guestId: 'guest_1', publishableKey: 'pk1' }),
    });
    store = new ChatStateStore(createInitialChatState());
    sendQueue = new SendQueue({ storage: new MemoryStorageAdapter(), namespace: 'q1' });
    fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messages: [], hasMore: false }), { status: 200 }));
    const restClient = new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl });

    coordinator = new MessageCoordinator({
      store,
      connection,
      sendQueue,
      restClient,
      getAuth: () => ({ guestId: 'guest_1' }),
      getSenderId: () => 'guest_1',
    });
    coordinator.attach();
  });

  afterEach(() => {
    coordinator.destroy();
    connection.destroy();
    vi.useRealTimers();
  });

  async function connectAndAck(): Promise<void> {
    connection.connect();
    currentSocket().simulateOpen();
    await vi.waitFor(() => expect(sentFrames().some((f) => f.t === 'connection.hello')).toBe(true));
    currentSocket().simulateMessage(JSON.stringify(ackFrame()));
    await vi.waitFor(() => expect(connection.state).toBe('connected'));
  }

  describe('sendMessage', () => {
    it('applies the message to state optimistically before anything else happens', async () => {
      await connectAndAck();

      const promise = coordinator.sendMessage('hello');
      // Synchronous append — no await needed before this is already true.
      expect(store.getState().messages.map((m) => m.content)).toContain('hello');
      await promise;
    });

    it('sends over the connection when already connected', async () => {
      await connectAndAck();

      await coordinator.sendMessage('hello');

      const sent = sentFrames().find((f) => f.t === 'message.send');
      expect(sent?.d['content']).toBe('hello');
    });

    it('queues the frame instead of throwing when disconnected after having been connected once', async () => {
      await connectAndAck();
      currentSocket().close(1006, 'dropped');
      expect(connection.state).toBe('reconnecting'); // synchronous, per connection-machine.test.ts's note

      await expect(coordinator.sendMessage('hello')).resolves.toBeUndefined();
    });

    it('throws only if there is no active session at all', async () => {
      // Never connected — no session id known yet.
      const freshStore = new ChatStateStore(createInitialChatState());
      const freshCoordinator = new MessageCoordinator({
        store: freshStore,
        connection,
        sendQueue,
        restClient: new RestClient({ apiUrl: 'https://api.example.com', publishableKey: 'pk1', fetchImpl }),
        getAuth: () => ({ guestId: 'guest_1' }),
        getSenderId: () => 'guest_1',
      });

      await expect(freshCoordinator.sendMessage('hello')).rejects.toThrow(/no active session/);
    });

    it('the queued frame flushes automatically once the connection reaches connected again', async () => {
      await connectAndAck();
      currentSocket().close(1006, 'dropped');

      await coordinator.sendMessage('queued while offline');
      expect(await sendQueue.peekAll()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(30_000); // clears the reconnect backoff
      await vi.waitFor(() => expect(connection.state).toBe('connecting'));
      currentSocket().simulateOpen();
      await vi.waitFor(() => expect(sentFrames().some((f) => f.t === 'connection.hello')).toBe(true));
      currentSocket().simulateMessage(JSON.stringify(ackFrame()));

      await vi.waitFor(() => expect(sentFrames().some((f) => f.d['content'] === 'queued while offline')).toBe(true));
    });

    it('uses the same id for the optimistic message and the sent frame (D1 — no id swap)', async () => {
      await connectAndAck();
      await coordinator.sendMessage('hello');

      const optimisticId = store.getState().messages.find((m) => m.content === 'hello')?.id;
      const sentId = sentFrames().find((f) => f.t === 'message.send')?.id;
      expect(optimisticId).toBe(sentId);
    });
  });

  describe('inbound message.new', () => {
    it('appends a message pushed by the server', async () => {
      await connectAndAck();

      currentSocket().simulateMessage(JSON.stringify(messageNewFrame({ content: 'from agent' })));

      expect(store.getState().messages.some((m) => m.content === 'from agent')).toBe(true);
    });

    it('does not duplicate when the server echoes back our own sent message under the same id', async () => {
      await connectAndAck();
      await coordinator.sendMessage('hello');
      const sentId = sentFrames().find((f) => f.t === 'message.send')?.id as string;

      currentSocket().simulateMessage(JSON.stringify(messageNewFrame({ id: sentId, senderId: 'guest_1', senderType: 'CUSTOMER', content: 'hello' })));

      const matches = store.getState().messages.filter((m) => m.id === sentId);
      expect(matches).toHaveLength(1);
    });
  });

  describe('ack correlation', () => {
    it('dequeues the send-queue entry once a matching ack arrives', async () => {
      await connectAndAck();

      await coordinator.sendMessage('acked eventually');
      const sentId = sentFrames().find((f) => f.t === 'message.send')?.id as string;
      await sendQueue.enqueue({ v: 1, t: 'message.send', id: sentId, ts: Date.now(), d: { content: 'x', type: 'TEXT' } });
      expect((await sendQueue.peekAll()).some((i) => i.id === sentId)).toBe(true);

      currentSocket().simulateMessage(JSON.stringify(ackFor(sentId)));
      await vi.waitFor(async () => expect((await sendQueue.peekAll()).some((i) => i.id === sentId)).toBe(false));
    });
  });

  describe('loadOlderMessages', () => {
    it('does nothing when there are no messages loaded yet', async () => {
      await coordinator.loadOlderMessages();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('prepends the fetched page and updates pagination', async () => {
      await connectAndAck();
      store.setState({ messages: [{ id: 'm5', chatSessionId: 's1', senderType: 'CUSTOMER', senderId: 'guest_1', senderName: null, content: 'existing', messageType: 'TEXT', createdAt: '2026-01-01T00:00:05.000Z', attachment: null, replyToMessageId: null, replyToMessage: null }] });
      fetchImpl.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ messages: [{ id: 'm1', chatSessionId: 's1', senderType: 'CUSTOMER', senderId: 'guest_1', content: 'older', messageType: 'TEXT', createdAt: '2026-01-01T00:00:01.000Z', attachment: null, replyToMessageId: null, replyToMessage: null, senderName: null }], hasMore: true }),
          { status: 200 },
        ),
      );

      await coordinator.loadOlderMessages();

      const state = store.getState();
      expect(state.messages.map((m) => m.id)).toEqual(['m1', 'm5']);
      expect(state.pagination).toEqual({ hasMore: true, loadingMore: false });
    });

    it('does not re-fetch while a load is already in progress', async () => {
      await connectAndAck();
      store.setState({ messages: [{ id: 'm5', chatSessionId: 's1', senderType: 'CUSTOMER', senderId: 'guest_1', senderName: null, content: 'x', messageType: 'TEXT', createdAt: '2026-01-01T00:00:05.000Z', attachment: null, replyToMessageId: null, replyToMessage: null }] });
      store.setState({ pagination: { hasMore: true, loadingMore: true } });

      await coordinator.loadOlderMessages();

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('does not fetch once hasMore is false', async () => {
      await connectAndAck();
      store.setState({ messages: [{ id: 'm5', chatSessionId: 's1', senderType: 'CUSTOMER', senderId: 'guest_1', senderName: null, content: 'x', messageType: 'TEXT', createdAt: '2026-01-01T00:00:05.000Z', attachment: null, replyToMessageId: null, replyToMessage: null }] });
      store.setState({ pagination: { hasMore: false, loadingMore: false } });

      await coordinator.loadOlderMessages();

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('sets lastError and clears loadingMore on a failed fetch', async () => {
      await connectAndAck();
      store.setState({ messages: [{ id: 'm5', chatSessionId: 's1', senderType: 'CUSTOMER', senderId: 'guest_1', senderName: null, content: 'x', messageType: 'TEXT', createdAt: '2026-01-01T00:00:05.000Z', attachment: null, replyToMessageId: null, replyToMessage: null }] });
      fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'boom' }), { status: 500 }));

      await coordinator.loadOlderMessages();

      const state = store.getState();
      expect(state.pagination.loadingMore).toBe(false);
      expect(state.lastError).not.toBeNull();
    });
  });

  describe('sendAttachment', () => {
    it('uploads the file, then sends a message.send with the resulting attachment metadata', async () => {
      await connectAndAck();
      const attachment = { url: 'https://x/y.png', fileName: 'y.png', mimeType: 'image/png', size: 3, mediaType: 'image' };
      fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(attachment), { status: 201 }));

      await coordinator.sendAttachment(new Blob(['abc'], { type: 'image/png' }), { fileName: 'y.png' });

      const sent = sentFrames().find((f) => f.t === 'message.send');
      expect(sent?.d['metadata']).toEqual({ attachment });
      const message = store.getState().messages.find((m) => m.attachment?.url === attachment.url);
      expect(message).toBeDefined();
    });

    it('sets uploading true during the upload and false afterward', async () => {
      await connectAndAck();
      let uploadingDuringUpload: boolean | undefined;
      fetchImpl.mockImplementationOnce(async () => {
        uploadingDuringUpload = store.getState().uploading;
        return new Response(JSON.stringify({ url: 'x', fileName: 'x', mimeType: 'x', size: 1, mediaType: 'x' }), { status: 201 });
      });

      await coordinator.sendAttachment(new Blob(['x']));

      expect(uploadingDuringUpload).toBe(true);
      expect(store.getState().uploading).toBe(false);
    });

    it('sets lastError and clears uploading on a failed upload, without sending a frame', async () => {
      await connectAndAck();
      fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'too big' }), { status: 413 }));

      await coordinator.sendAttachment(new Blob(['x']));

      expect(store.getState().uploading).toBe(false);
      expect(store.getState().lastError).not.toBeNull();
      expect(sentFrames().some((f) => f.t === 'message.send')).toBe(false);
    });
  });
});
