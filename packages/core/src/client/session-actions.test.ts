// What core does when a session action half-succeeds.
//
// `SessionActions` implementations may need two round trips (the REST adapter
// does: a mutating POST, then a read of the full session). This file covers the
// window between them — the server applied the change, the value describing it
// never arrived — because that is the case where rejecting plainly leaves
// `ChatState.session` describing a session that no longer exists in that form.
//
// Everything goes through `createChatClient`'s public surface; the only doubles
// are `ChatClientConfig` seams a real consumer also supplies.

import { describe, expect, it } from 'vitest';

import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { StubSocketFactory } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClientConfig, SessionActions } from './types.js';
import type { ChatError, ChatSession } from '../state/index.js';

const CUSTOMER_ID = 'participant_customer_1';

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function ackJson(): unknown {
  const session: SessionSnapshot = {
    sessionId: 'session_1',
    status: 'ASSIGNED',
    mode: 'HUMAN',
    participants: [{ participantId: CUSTOMER_ID, type: 'CUSTOMER' }],
    createdAt: '2026-08-18T09:00:00.000Z',
  };
  const payload: ConnectionAckPayload = { protocolVersion: 1, session, seq: 0 };
  return { v: 1, t: 'connection.ack', id: '01ARZ3NDEKTSV4RRFFQ69G5FAA', ts: 0, d: payload };
}

function harness(sessionActions: SessionActions) {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const config: ChatClientConfig = {
    publishableKey: 'dhp' + '_test_actions1',
    getToken: async () => 'tok',
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    storage: new MemoryStorageAdapter(),
    localSender: { senderId: CUSTOMER_ID, senderType: 'CUSTOMER' },
    history: { listMessages: async () => ({ messages: [], hasMore: false }) },
    sessionActions,
    webSocketFactory: sockets.create,
    schedule: timers.schedule,
    now: timers.clock,
  };
  return { sockets, client: createChatClient(config) };
}

/** Connects far enough that `ChatState.session` is populated. */
async function connected(sessionActions: SessionActions) {
  const h = harness(sessionActions);
  const connecting = h.client.connect();
  await tick();
  h.sockets.last.open();
  h.sockets.last.emitJson(ackJson());
  await connecting;
  await tick();
  return h;
}

/** The error a two-round-trip adapter raises when only the read-back failed. */
function readBackFailure(): Error & { sessionMutationApplied: true } {
  const error = new Error('the session was changed, but the updated session could not be read back');
  return Object.assign(error, { sessionMutationApplied: true as const });
}

function neverCalled(): never {
  throw new Error('not expected in this test');
}

describe('closeSession — the mutation landed but the read-back did not', () => {
  it('surfaces a ChatError instead of leaving the staleness silent', async () => {
    const h = await connected({
      reopenSession: neverCalled,
      closeSession: async () => {
        throw readBackFailure();
      },
      submitCsat: neverCalled,
    });
    const errors: ChatError[] = [];
    h.client.on('error', (error) => errors.push(error));

    await expect(h.client.closeSession()).rejects.toMatchObject({
      sessionMutationApplied: true,
    });
    await tick();

    // The server HAS closed this session. Core cannot repair the state — it
    // does not know the new status — but it must not stay quiet about it.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.retryable).toBe(true);
    expect(h.client.getState().lastError).toEqual(errors[0]);
  });

  it('never copies the adapter error text into the ChatError (§14)', async () => {
    const h = await connected({
      reopenSession: neverCalled,
      closeSession: async () => {
        throw Object.assign(
          new Error('GET /full failed: https://cdn.test/x?X-Amz-Signature=SECRETSIG'),
          { sessionMutationApplied: true },
        );
      },
      submitCsat: neverCalled,
    });

    await expect(h.client.closeSession()).rejects.toThrow();
    await tick();

    expect(h.client.getState().lastError?.message).not.toContain('SECRETSIG');
  });

  it('leaves the previous session in place rather than blanking it', async () => {
    const h = await connected({
      reopenSession: neverCalled,
      closeSession: async () => {
        throw readBackFailure();
      },
      submitCsat: neverCalled,
    });

    await expect(h.client.closeSession()).rejects.toThrow();
    await tick();

    // Stale, and now flagged — but still the best information core has. A
    // null session would tell the UI there is no conversation at all.
    expect(h.client.getState().session?.id).toBe('session_1');
  });

  it('stays silent for an ordinary failure, where the action did NOT happen', async () => {
    const h = await connected({
      reopenSession: neverCalled,
      closeSession: async () => {
        throw new Error('connection refused');
      },
      submitCsat: neverCalled,
    });
    const errors: ChatError[] = [];
    h.client.on('error', (error) => errors.push(error));

    await expect(h.client.closeSession()).rejects.toThrow('connection refused');
    await tick();

    expect(errors).toHaveLength(0);
    expect(h.client.getState().lastError).toBeNull();
  });

  it('updates the session as usual when both round trips succeed', async () => {
    const closed: ChatSession = {
      id: 'session_1',
      status: 'CLOSED',
      mode: 'HUMAN',
      createdAt: '2026-08-18T09:00:00.000Z',
      closedAt: '2026-08-18T10:00:00.000Z',
      assignedAgent: null,
      customer: null,
      ticket: null,
    };
    const h = await connected({
      reopenSession: neverCalled,
      closeSession: async () => closed,
      submitCsat: neverCalled,
    });

    await h.client.closeSession();
    await tick();

    expect(h.client.getState().session).toEqual(closed);
    expect(h.client.getState().lastError).toBeNull();
  });
});

describe('reopenSession — same window, same handling', () => {
  it('reports the applied-but-unconfirmed change and still rejects', async () => {
    const h = harness({
      reopenSession: async () => {
        throw readBackFailure();
      },
      closeSession: neverCalled,
      submitCsat: neverCalled,
    });
    const errors: ChatError[] = [];
    h.client.on('error', (error) => errors.push(error));

    await expect(h.client.reopenSession('session_9')).rejects.toMatchObject({
      sessionMutationApplied: true,
    });
    await tick();

    expect(errors).toHaveLength(1);
    expect(h.client.getState().lastError?.message).toContain('could not be read back');
  });
});
