import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import type { AnyFrame } from '../../src/protocol/index.js';
import { FakeWsServer } from './fake-ws-server.js';
import { testUlid } from './test-ulid.js';

function heartbeatFrame(): AnyFrame {
  return { v: 1, t: 'system.heartbeat', id: testUlid(), ts: Date.now(), d: {} };
}

function pongFrame(): AnyFrame {
  return { v: 1, t: 'system.pong', id: testUlid(), ts: Date.now(), d: {} };
}

function connectClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (raw) => resolve(JSON.parse(raw.toString('utf8'))));
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reasonBuf) => resolve({ code, reason: reasonBuf.toString('utf8') }));
  });
}

describe('FakeWsServer', () => {
  const openServers: FakeWsServer[] = [];
  const openSockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }
    for (const server of openServers.splice(0)) {
      await server.close();
    }
  });

  async function startServer(options: Parameters<typeof FakeWsServer.start>[0] = {}): Promise<FakeWsServer> {
    const server = await FakeWsServer.start(options);
    openServers.push(server);
    return server;
  }

  async function connect(url: string): Promise<WebSocket> {
    const socket = await connectClient(url);
    openSockets.push(socket);
    return socket;
  }

  it('starts and exposes a ws:// loopback URL', async () => {
    const server = await startServer();

    expect(server.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
  });

  it('fires onConnect with a client handle when a socket connects', async () => {
    const onConnect = vi.fn();
    const server = await startServer({ onConnect });

    await connect(server.url);

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect.mock.calls[0]?.[0]).toMatchObject({ id: expect.any(String) });
  });

  it('assigns each connected client a distinct id', async () => {
    const seen: string[] = [];
    const server = await startServer({ onConnect: (client) => seen.push(client.id) });

    await connect(server.url);
    await connect(server.url);

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('parses a valid inbound frame and fires onFrame with it', async () => {
    const onFrame = vi.fn();
    const server = await startServer({ onFrame });
    const socket = await connect(server.url);
    const frame = heartbeatFrame();

    socket.send(JSON.stringify(frame));
    await vi.waitFor(() => expect(onFrame).toHaveBeenCalledTimes(1));

    expect(onFrame.mock.calls[0]?.[1]).toEqual(frame);
  });

  it('rejects a frame that fails protocol validation rather than delivering it to onFrame', async () => {
    const onFrame = vi.fn();
    const onInvalidFrame = vi.fn();
    const server = await startServer({ onFrame, onInvalidFrame });
    const socket = await connect(server.url);

    // Missing required fields — not a valid frame per protocol/validate.ts.
    socket.send(JSON.stringify({ t: 'system.heartbeat' }));
    await vi.waitFor(() => expect(onInvalidFrame).toHaveBeenCalledTimes(1));

    expect(onFrame).not.toHaveBeenCalled();
    expect(onInvalidFrame.mock.calls[0]?.[1]).toMatchObject({ ok: false });
  });

  it('rejects non-JSON input the same way as a structurally invalid frame', async () => {
    const onInvalidFrame = vi.fn();
    const server = await startServer({ onInvalidFrame });
    const socket = await connect(server.url);

    socket.send('not json at all {{{');
    await vi.waitFor(() => expect(onInvalidFrame).toHaveBeenCalledTimes(1));

    expect(onInvalidFrame.mock.calls[0]?.[1]).toMatchObject({ ok: false, reason: expect.stringContaining('JSON') });
  });

  it('closes the connection with code 1002 on an invalid frame when no onInvalidFrame handler is given', async () => {
    const server = await startServer();
    const socket = await connect(server.url);
    const closed = waitForClose(socket);

    socket.send(JSON.stringify({ not: 'a frame' }));
    const { code } = await closed;

    expect(code).toBe(1002);
  });

  it('sends a frame to a specific client and the client receives it, round-tripped through JSON', async () => {
    const server = await startServer();
    const socket = await connect(server.url);
    await vi.waitFor(() => expect(server.clients).toHaveLength(1));
    const frame = pongFrame();

    const received = waitForMessage(socket);
    server.clients[0]?.send(frame);

    expect(await received).toEqual(frame);
  });

  it('broadcasts a frame to every connected client, and only connected clients', async () => {
    const server = await startServer();
    const a = await connect(server.url);
    const b = await connect(server.url);
    await vi.waitFor(() => expect(server.clients).toHaveLength(2));
    const frame = pongFrame();

    const receivedA = waitForMessage(a);
    const receivedB = waitForMessage(b);
    server.broadcast(frame);

    expect(await receivedA).toEqual(frame);
    expect(await receivedB).toEqual(frame);
  });

  it('fires onDisconnect with a close code when a client disconnects', async () => {
    const onDisconnect = vi.fn();
    const server = await startServer({ onDisconnect });
    const socket = await connect(server.url);
    await vi.waitFor(() => expect(server.clients).toHaveLength(1));

    socket.close(1000, 'bye');
    await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));

    expect(onDisconnect.mock.calls[0]?.[1]).toBe(1000);
  });

  it('removes a disconnected client from the clients list', async () => {
    const server = await startServer();
    const socket = await connect(server.url);
    await vi.waitFor(() => expect(server.clients).toHaveLength(1));

    socket.close();
    await vi.waitFor(() => expect(server.clients).toHaveLength(0));
  });

  it('rejects new connection attempts after close()', async () => {
    const server = await FakeWsServer.start();
    const url = server.url;
    await server.close();

    await expect(connectClient(url)).rejects.toBeDefined();
  });
});
