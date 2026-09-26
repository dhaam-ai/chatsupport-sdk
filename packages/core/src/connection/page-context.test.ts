// connection.hello — the visitor's page context
//
// Page flows ("a visitor is on checkout") are chosen when the session is
// created, so the context has to be on the hello itself, not sent afterwards.
// It is asked for on EVERY hello (reconnects included) — the server keeps it
// on the connection, and a reconnect that forgot it would drop the visitor off
// their page flow — and it is ABSENT, not `{}`, when nothing is known, which
// is what keeps every host that never calls `setPage` byte-for-byte unchanged.

import { describe, expect, it, vi } from 'vitest';

import { AuthBackoffPolicy, TransportBackoffPolicy } from '../backoff/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, ServerFrame, SessionSnapshot, VisitorContext } from '../protocol/index.js';
import { ChatStore, createInitialChatState } from '../state/index.js';
import { ConnectionController } from './controller.js';
import { FakeTransport } from './fake-transport.js';
import type { TokenProvider } from './types.js';

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const SESSION_SNAPSHOT: SessionSnapshot = {
  sessionId: 'sess_1',
  status: 'OPEN',
  mode: 'BOT',
  participants: [],
  createdAt: '2026-08-17T00:00:00.000Z',
};

function ackFrame(overrides: Partial<ConnectionAckPayload> = {}): ServerFrame {
  return {
    v: 1, t: 'connection.ack', id: 'srv_ack', ts: 0,
    d: { protocolVersion: 1, session: SESSION_SNAPSHOT, seq: 0, ...overrides },
  };
}

function harness(pageContext?: () => VisitorContext | undefined) {
  const store = new ChatStore({ initialState: createInitialChatState() });
  const timers = new ManualTimers();
  let transport!: FakeTransport;

  const controller = new ConnectionController({
    store,
    url: 'wss://example.test/chat-services/v2/ws',
    publishableKey: 'dhp_test_1',
    ...(pageContext === undefined ? {} : { pageContext }),
    getToken: vi.fn(async () => 'tok_abc') as unknown as TokenProvider,
    schedule: timers.schedule,
    transportBackoff: new TransportBackoffPolicy({ random: () => 1 }),
    authBackoff: new AuthBackoffPolicy({ random: () => 1 }),
    createTransport: (handlers) => {
      transport = new FakeTransport(handlers);
      return transport;
    },
  });

  return { timers, controller, get transport() { return transport; } };
}

async function connect(h: ReturnType<typeof harness>): Promise<void> {
  const p = h.controller.connect();
  await tick();
  h.transport.open();
  h.transport.emitFrame(ackFrame());
  await p;
}

describe('the page context on the hello', () => {
  it('is carried when the host supplied one', async () => {
    const h = harness(() => ({ label: 'checkout', url: '/checkout' }));
    await connect(h);
    const hello = h.transport.connects[0]!.hello as Record<string, unknown>;
    expect(hello.context).toEqual({ label: 'checkout', url: '/checkout' });
  });

  it('is asked for again on every reconnect, so the latest page goes out each time', async () => {
    let page: VisitorContext = { label: 'cart' };
    const h = harness(() => page);
    await connect(h);

    page = { label: 'payment' };
    h.transport.drop();
    await tick();
    h.timers.advance(120_000);
    await tick();
    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await tick();

    const labels = h.transport.connects.map((c) => (c.hello as { context?: VisitorContext }).context?.label);
    expect(labels[0]).toBe('cart');
    expect(labels.at(-1)).toBe('payment');
  });

  it('is absent when the host has nothing to say', async () => {
    const h = harness(() => undefined);
    await connect(h);
    const hello = h.transport.connects[0]!.hello as Record<string, unknown>;
    expect('context' in hello).toBe(false);
  });

  it('is absent, and the hello is unchanged, when no provider was given at all', async () => {
    const h = harness();
    await connect(h);
    const hello = h.transport.connects[0]!.hello as Record<string, unknown>;
    expect('context' in hello).toBe(false);
  });

  it('a provider that throws never costs the visitor their chat', async () => {
    const h = harness(() => {
      throw new Error('host bug');
    });
    await connect(h);
    const hello = h.transport.connects[0]!.hello as Record<string, unknown>;
    expect('context' in hello).toBe(false);
    expect(hello.token).toBe('tok_abc');
  });
});
