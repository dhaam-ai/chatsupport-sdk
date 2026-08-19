// Real end-to-end proof: `Transport`, using its default (global) WebSocket
// factory, against `FakeWsServer` (task T6) over an actual loopback socket —
// not mocks on either side. This is the "conformance target" plan.md
// describes: if this suite passes, the transport layer's wire behavior, not
// just its internal wiring, has been exercised.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AnyFrame } from '../protocol/index.js';
import { FakeWsServer } from '../../test/fake-server/index.js';
import { Transport } from './transport.js';

function heartbeatOrPongSafeFrame(): AnyFrame {
  return {
    v: 1,
    t: 'session.requestAgent',
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    ts: Date.now(),
    d: { reason: 'test' },
  };
}

describe('Transport + FakeWsServer (integration)', () => {
  const servers: FakeWsServer[] = [];
  const transports: Transport[] = [];

  afterEach(async () => {
    for (const transport of transports.splice(0)) {
      transport.close();
    }
    for (const server of servers.splice(0)) {
      await server.close();
    }
  });

  async function startServer(options: Parameters<typeof FakeWsServer.start>[0] = {}): Promise<FakeWsServer> {
    const server = await FakeWsServer.start(options);
    servers.push(server);
    return server;
  }

  function makeTransport(): Transport {
    const transport = new Transport();
    transports.push(transport);
    return transport;
  }

  it('opens a real connection and both sides observe it', async () => {
    const onConnect = vi.fn();
    const server = await startServer({ onConnect });
    const transport = makeTransport();
    const opened = new Promise<void>((resolve) => transport.on('open', () => resolve()));

    transport.connect(server.url);
    await opened;

    expect(transport.isOpen).toBe(true);
  });

  it('a frame sent by the client is received and validated by the real fake server', async () => {
    const onFrame = vi.fn();
    const server = await startServer({ onFrame });
    const transport = makeTransport();
    const opened = new Promise<void>((resolve) => transport.on('open', () => resolve()));
    transport.connect(server.url);
    await opened;

    const frame = heartbeatOrPongSafeFrame();
    transport.send(frame);
    await vi.waitFor(() => expect(onFrame).toHaveBeenCalledTimes(1));

    expect(onFrame.mock.calls[0]?.[1]).toEqual(frame);
  });

  it('a frame pushed by the server is received and parsed by the transport', async () => {
    const server = await startServer();
    const transport = makeTransport();
    const received = new Promise<AnyFrame>((resolve) => transport.on('frame', (frame) => resolve(frame)));
    const opened = new Promise<void>((resolve) => transport.on('open', () => resolve()));
    transport.connect(server.url);
    await opened;
    await vi.waitFor(() => expect(server.clients).toHaveLength(1));

    const frame: AnyFrame = { v: 1, t: 'system.pong', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', ts: Date.now(), d: {} };
    server.clients[0]?.send(frame);

    expect(await received).toEqual(frame);
  });

  it('closing from the server side surfaces as a "close" event on the transport', async () => {
    const server = await startServer();
    const transport = makeTransport();
    const opened = new Promise<void>((resolve) => transport.on('open', () => resolve()));
    const closed = new Promise<{ code: number; reason: string }>((resolve) => transport.on('close', resolve));
    transport.connect(server.url);
    await opened;
    await vi.waitFor(() => expect(server.clients).toHaveLength(1));

    server.clients[0]?.close(1000, 'server says bye');
    const event = await closed;

    expect(event.code).toBe(1000);
    expect(transport.isOpen).toBe(false);
  });
});
