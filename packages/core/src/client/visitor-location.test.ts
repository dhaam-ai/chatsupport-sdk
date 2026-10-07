// The visitor's position (the browser's GPS fix, handed to the client with `setContactInfo`), through `createChatClient`'s
// public surface: it rides the page context -- the hello when it is known by then, a `context.update` when it arrives later --
// so a chat already open tells the server where the visitor is. The time zone is switched off here: it is not this file's subject.

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
    timeZone: null,
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


describe('the visitor\'s GPS fix and the page context', () => {
  it('known before the chat connects: it rides the hello, with the page, and is not repeated as an update', async () => {
    const h = harness();
    h.client.setPageContext({ label: 'cart' });
    h.client.setContactInfo({ geo: { lat: 17.408084, lng: 78.491033 } });
    await connect(h);
    expect(framesOf(h, 'connection.hello')[0]?.d['context']).toEqual({ label: 'cart', location: { lat: 17.408, lng: 78.491 } });
    h.timers.advance(5_000);
    expect(framesOf(h, 'context.update')).toEqual([]);
  });

  it('arrives after the hello (the usual case: the visitor answers the browser prompt later): one context.update carries it', async () => {
    const h = harness();
    h.client.setPageContext({ label: 'cart', attributes: { menuId: 'm1' } });
    await connect(h);
    expect(framesOf(h, 'connection.hello')[0]?.d['context']).toEqual({ label: 'cart', attributes: { menuId: 'm1' } });

    h.client.setContactInfo({ geo: { lat: 17.408084, lng: 78.491033 } });
    h.timers.advance(1_000);
    expect(framesOf(h, 'context.update').map((frame) => frame.d)).toEqual([
      { label: 'cart', attributes: { menuId: 'm1' }, location: { lat: 17.408, lng: 78.491 } },
    ]);
  });

  it('the same place again, or a move inside the three decimals, sends nothing more', async () => {
    const h = harness();
    await connect(h);
    h.client.setContactInfo({ geo: { lat: 17.40801, lng: 78.49101 } });
    h.timers.advance(1_000);
    h.client.setContactInfo({ geo: { lat: 17.40801, lng: 78.49101 } });
    h.client.setContactInfo({ geo: { lat: 17.40804, lng: 78.49104 } });
    h.timers.advance(1_000);
    expect(framesOf(h, 'context.update')).toHaveLength(1);
  });

  it('works for a page that set no context at all: the update is just where they are', async () => {
    const h = harness();
    await connect(h);
    h.client.setContactInfo({ geo: { lat: 12.971599, lng: 77.594566 } });
    h.timers.advance(1_000);
    expect(framesOf(h, 'context.update').map((frame) => frame.d)).toEqual([{ location: { lat: 12.972, lng: 77.595 } }]);
  });

  it('a later setPageContext keeps the position (an update REPLACES the stored context)', async () => {
    const h = harness();
    await connect(h);
    h.client.setContactInfo({ geo: { lat: 17.408084, lng: 78.491033 } });
    h.timers.advance(1_000);
    h.client.setPageContext({ label: 'checkout' });
    h.timers.advance(1_000);
    expect(framesOf(h, 'context.update').map((frame) => frame.d).at(-1)).toEqual({ label: 'checkout', location: { lat: 17.408, lng: 78.491 } });
  });

  it('the contact-info path is untouched: the geo still rides the hello for the console', async () => {
    const h = harness();
    h.client.setContactInfo({ geo: { lat: 17.408084, lng: 78.491033 } });
    await connect(h);
    expect(framesOf(h, 'connection.hello')[0]?.d['geo']).toEqual({ lat: 17.408084, lng: 78.491033 });
  });

  it('an impossible fix is no position and never an exception', async () => {
    const h = harness();
    await connect(h);
    expect(() => h.client.setContactInfo({ geo: { lat: 99, lng: 0 } })).not.toThrow();
    h.timers.advance(5_000);
    expect(framesOf(h, 'context.update')).toEqual([]);
  });
});
