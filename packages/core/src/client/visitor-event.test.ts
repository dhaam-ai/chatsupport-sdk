// client.sendVisitorEvent — chatbot-workflows-commerce.md §4, through
// createChatClient's public surface.

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

function harness(logger = (_level: string, _msg: string, _meta?: Record<string, unknown>) => undefined) {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const config: ChatClientConfig = {
    publishableKey: 'dhp' + '_test_visitorevent1',
    getToken: async () => 'tok_ve',
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    storage: new MemoryStorageAdapter(),
    localSender: { senderId: CUSTOMER_ID, senderType: 'CUSTOMER' },
    history: new EmptyHistory(),
    webSocketFactory: sockets.create,
    schedule: timers.schedule,
    now: timers.clock,
    logger: (level, msg, meta) => logger(level, msg, meta),
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

describe('sendVisitorEvent while connected', () => {
  it('sends immediately, with no coalescing delay', async () => {
    const h = harness();
    await connect(h);
    h.client.sendVisitorEvent('exit_intent', {});
    const events = framesOf(h, 'visitor.event');
    expect(events).toHaveLength(1);
    expect(events[0]?.d).toEqual({ name: 'exit_intent', props: {} });
  });

  it('sends two events fired in the same tick as two distinct frames — never coalesced', async () => {
    const h = harness();
    await connect(h);
    h.client.sendVisitorEvent('cart_updated', { items: 1 });
    h.client.sendVisitorEvent('cart_updated', { items: 2 });
    expect(framesOf(h, 'visitor.event')).toHaveLength(2);
  });

  it('drops an unrecognised name with a logger warning, and never throws', async () => {
    const warnings: string[] = [];
    const h = harness((level, msg) => {
      if (level === 'warn') warnings.push(msg);
    });
    await connect(h);
    expect(() => h.client.sendVisitorEvent('made_up_event', {})).not.toThrow();
    expect(framesOf(h, 'visitor.event')).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('drops the whole event when a required prop is missing or invalid', async () => {
    const h = harness();
    await connect(h);
    h.client.sendVisitorEvent('cart_updated', { items: -5, value: 'free' });
    expect(framesOf(h, 'visitor.event')).toHaveLength(0);
  });
});

describe('sendVisitorEvent before the connection exists', () => {
  it('is dropped, not queued, and never throws or blocks connect()', async () => {
    const h = harness();
    expect(() => h.client.sendVisitorEvent('exit_intent', {})).not.toThrow();
    await connect(h);
    expect(framesOf(h, 'visitor.event')).toHaveLength(0);
  });
});
