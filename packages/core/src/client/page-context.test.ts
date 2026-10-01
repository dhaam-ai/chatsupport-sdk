// The visitor's page context, through `createChatClient`'s public surface:
// what rides on the hello, and when a `context.update` follows it.

import { describe, expect, it } from 'vitest';

import type { MessageHistorySource, MessagePage } from '../messages/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { StubSocketFactory } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClientConfig } from './types.js';

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const CUSTOMER_ID = 'participant_customer_1';

const SESSION: SessionSnapshot = {
  sessionId: 'session_1',
  status: 'OPEN',
  mode: 'BOT',
  participants: [{ participantId: CUSTOMER_ID, type: 'CUSTOMER' }],
  createdAt: '2026-08-18T09:00:00.000Z',
};

function ackJson(): unknown {
  const payload: ConnectionAckPayload = { protocolVersion: 1, session: SESSION, seq: 0 };
  return { v: 1, t: 'connection.ack', id: '01ARZ3NDEKTSV4RRFFQ69G5FAA', ts: 0, d: payload };
}

class EmptyHistory implements MessageHistorySource {
  async listMessages(): Promise<MessagePage> {
    return { messages: [], hasMore: false };
  }
}

function harness() {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const config: ChatClientConfig = {
    publishableKey: 'dhp' + '_test_pagectx1',
    getToken: async () => 'tok_ctx',
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    storage: new MemoryStorageAdapter(),
    localSender: { senderId: CUSTOMER_ID, senderType: 'CUSTOMER' },
    history: new EmptyHistory(),
    webSocketFactory: sockets.create,
    schedule: timers.schedule,
    now: timers.clock,
  };
  const client = createChatClient(config);
  return { client, sockets, timers };
}

type Frame = { t: string; d: Record<string, unknown> };

const framesOf = (h: ReturnType<typeof harness>, type: string): Frame[] =>
  (h.sockets.last.sentFrames() as Frame[]).filter((frame) => frame.t === type);

async function connect(h: ReturnType<typeof harness>): Promise<void> {
  const connecting = h.client.connect();
  await tick();
  h.sockets.last.open();
  h.sockets.last.emitJson(ackJson());
  await connecting;
  await tick();
}

describe('setPageContext before the connection exists', () => {
  it('rides on the hello, and is not repeated as an update', async () => {
    const h = harness();
    h.client.setPageContext({ label: 'Checkout', url: '/checkout', attributes: { cartValue: 1299 } });
    await connect(h);

    const [hello] = framesOf(h, 'connection.hello');
    expect(hello?.d['context']).toEqual({ label: 'checkout', url: '/checkout', attributes: { cartValue: 1299 } });

    h.timers.advance(5_000);
    expect(framesOf(h, 'context.update')).toEqual([]);
  });
});

describe('a host that never sets a page', () => {
  it('sends a hello with no context key at all, and no update', async () => {
    const h = harness();
    await connect(h);
    const [hello] = framesOf(h, 'connection.hello');
    expect('context' in (hello?.d ?? {})).toBe(false);
    h.timers.advance(5_000);
    expect(framesOf(h, 'context.update')).toEqual([]);
  });
});

describe('setPageContext while connected', () => {
  it('sends one context.update carrying only context fields, after a short pause', async () => {
    const h = harness();
    await connect(h);

    h.client.setPageContext({ label: 'payment', url: '/checkout/pay' });
    expect(framesOf(h, 'context.update')).toEqual([]);
    h.timers.advance(600);

    const updates = framesOf(h, 'context.update');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.d).toEqual({ label: 'payment', url: '/checkout/pay' });
  });

  it('does not repeat an update for the same page', async () => {
    const h = harness();
    await connect(h);
    h.client.setPageContext({ label: 'cart' });
    h.timers.advance(1_000);
    h.client.setPageContext({ label: 'cart' });
    h.timers.advance(1_000);
    expect(framesOf(h, 'context.update')).toHaveLength(1);
  });

  it('sends a page set between the hello and its ack as soon as the connection is up', async () => {
    const h = harness();
    h.client.setPageContext({ label: 'cart' });
    const connecting = h.client.connect();
    await tick();
    h.sockets.last.open(); // the hello is built here and carries "cart"
    h.client.setPageContext({ label: 'checkout' }); // not connected yet: only latched
    h.sockets.last.emitJson(ackJson());
    await connecting;
    await tick();

    expect(framesOf(h, 'connection.hello')[0]?.d['context']).toEqual({ label: 'cart' });
    expect(framesOf(h, 'context.update').map((frame) => frame.d['label'])).toEqual(['checkout']);
  });

  it('ignores input that is not an object, without throwing', async () => {
    const h = harness();
    await connect(h);
    expect(() => h.client.setPageContext('checkout')).not.toThrow();
    expect(() => h.client.setPageContext(undefined)).not.toThrow();
    h.timers.advance(5_000);
    expect(framesOf(h, 'context.update')).toEqual([]);
  });
});
