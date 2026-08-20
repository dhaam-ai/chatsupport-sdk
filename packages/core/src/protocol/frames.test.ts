import { describe, expect, it } from 'vitest';
import {
  ALL_FRAME_TYPES,
  CLIENT_TO_SERVER_FRAME_TYPES,
  SERVER_PUSH_FRAME_TYPES,
  SERVER_TO_CLIENT_FRAME_TYPES,
} from './frames.js';
import type { AnyFrame } from './frames.js';

describe('frame type catalog — §7.3', () => {
  it('has exactly the 13 client→server frame types', () => {
    expect(CLIENT_TO_SERVER_FRAME_TYPES).toEqual([
      'connection.hello',
      'connection.reauth',
      'session.join',
      'session.leave',
      'session.requestAgent',
      'message.send',
      'message.markRead',
      'message.markDelivered',
      'typing.start',
      'typing.stop',
      'presence.set',
      'presence.query',
      'system.heartbeat',
    ]);
  });

  it('has exactly the 13 plain server push frame types (excludes ack/error)', () => {
    expect(SERVER_PUSH_FRAME_TYPES).toEqual([
      'connection.ack',
      'session.updated',
      'session.closed',
      'agent.joined',
      'agent.left',
      'message.new',
      'typing.start',
      'typing.stop',
      'message.read',
      'message.delivered',
      'presence.update',
      'ticket.linked',
      'system.pong',
    ]);
    expect(SERVER_PUSH_FRAME_TYPES).not.toContain('ack');
    expect(SERVER_PUSH_FRAME_TYPES).not.toContain('error');
  });

  it('server→client set adds exactly ack and error to the push set', () => {
    expect(SERVER_TO_CLIENT_FRAME_TYPES).toEqual([...SERVER_PUSH_FRAME_TYPES, 'ack', 'error']);
  });

  it('has 26 distinct frame type strings total (typing.start/stop shared, not double-counted)', () => {
    const distinct = new Set(ALL_FRAME_TYPES);
    expect(distinct.size).toBe(26);
  });

  it('typing.start and typing.stop are the one shared pair used in both directions (§7.3)', () => {
    expect(CLIENT_TO_SERVER_FRAME_TYPES).toContain('typing.start');
    expect(CLIENT_TO_SERVER_FRAME_TYPES).toContain('typing.stop');
    expect(SERVER_PUSH_FRAME_TYPES).toContain('typing.start');
    expect(SERVER_PUSH_FRAME_TYPES).toContain('typing.stop');
  });
});

// ---------------------------------------------------------------------------
// Exhaustive narrowing over the discriminated union.
//
// This function is the compile-time proof the task requires: every member
// of `AnyFrame` is handled by literal `t`, `frame.d` narrows to the exact
// payload shape for that `t` with NO casts anywhere below, and the
// `default` branch's `const exhaustive: never = frame` line fails `tsc`
// the moment a case is added to the catalog without a matching case here.
// If this file typechecks, exhaustive narrowing holds.
// ---------------------------------------------------------------------------

function describeFrame(frame: AnyFrame): string {
  switch (frame.t) {
    case 'connection.hello':
      return `hello:${frame.d.publishableKey}:${frame.d.protocolVersion}`;
    case 'connection.reauth':
      return `reauth:${frame.d.token}`;
    case 'session.join':
      return `join:${frame.d.sessionId}`;
    case 'session.leave':
      return 'leave';
    case 'session.requestAgent':
      return `requestAgent:${frame.d.reason ?? ''}`;
    case 'message.send':
      return `send:${frame.d.content}:${frame.d.type}`;
    case 'message.markRead':
      return `markRead:${frame.d.upToMessageId ?? ''}`;
    case 'message.markDelivered':
      return `markDelivered:${frame.d.upToSeq}`;
    case 'typing.start':
      return `typingStart:${frame.d.participantId ?? ''}`;
    case 'typing.stop':
      return `typingStop:${frame.d.participantId ?? ''}`;
    case 'presence.set':
      return `presenceSet:${frame.d.status}`;
    case 'presence.query':
      return `presenceQuery:${(frame.d.participantIds ?? []).length}`;
    case 'system.heartbeat':
      return 'heartbeat';
    case 'connection.ack':
      return `ack:${frame.d.seq}:${frame.d.session.sessionId}`;
    case 'session.updated':
      return `sessionUpdated:${frame.d.session.status}`;
    case 'session.closed':
      return `sessionClosed:${frame.d.closeReason}`;
    case 'agent.joined':
      return `agentJoined:${frame.d.kind}:${frame.d.id}:${frame.d.displayName}`;
    case 'agent.left':
      return `agentLeft:${frame.d.kind}:${frame.d.id}:${frame.d.displayName}`;
    case 'message.new':
      return `messageNew:${frame.d.id}:${frame.d.seq}`;
    case 'message.read':
      return `messageRead:${frame.d.participantId}:${frame.d.readAt}`;
    case 'message.delivered':
      return `messageDelivered:${frame.d.participantId}:${frame.d.deliveredUpToSeq}`;
    case 'presence.update':
      return `presenceUpdate:${frame.d.participantId}:${frame.d.status}`;
    case 'ticket.linked':
      return `ticketLinked:${frame.d.ticketId}`;
    case 'system.pong':
      return 'pong';
    case 'ack': {
      if (frame.d.ok) {
        return 'genericAckOk';
      }
      return `genericAckErr:${frame.d.error.code}`;
    }
    case 'error':
      return `error:${frame.d.code}`;
    default: {
      // If this line fails to typecheck, a frame type was added to the
      // catalog (frames.ts) without a matching `case` above.
      const exhaustive: never = frame;
      throw new Error(`unhandled frame type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

describe('exhaustive switch(frame.t) narrowing', () => {
  it('narrows every client→server frame type correctly', () => {
    expect(
      describeFrame({
        v: 1,
        t: 'connection.hello',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: { token: 'tok', publishableKey: 'dhp_test_1', protocolVersion: 1 },
      }),
    ).toBe('hello:dhp_test_1:1');

    expect(
      describeFrame({
        v: 1,
        t: 'message.send',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: { content: 'hi', type: 'TEXT' },
      }),
    ).toBe('send:hi:TEXT');

    expect(
      describeFrame({
        v: 1,
        t: 'session.leave',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: {},
      }),
    ).toBe('leave');
  });

  it('narrows every server→client push frame type correctly', () => {
    expect(
      describeFrame({
        v: 1,
        t: 'connection.ack',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: {
          protocolVersion: 1,
          seq: 42,
          session: {
            sessionId: 'sess_1',
            status: 'OPEN',
            mode: 'BOT',
            participants: [],
            createdAt: '2026-08-17T00:00:00.000Z',
          },
        },
      }),
    ).toBe('ack:42:sess_1');

    expect(
      describeFrame({
        v: 1,
        t: 'session.closed',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: { sessionId: 'sess_1', closeReason: 'SWITCHED' },
      }),
    ).toBe('sessionClosed:SWITCHED');
  });

  it('narrows the generic ack frame on both the ok:true and ok:false branches', () => {
    expect(
      describeFrame({
        v: 1,
        t: 'ack',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        ref: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: { ok: true, seq: 7 },
      }),
    ).toBe('genericAckOk');

    expect(
      describeFrame({
        v: 1,
        t: 'ack',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        ref: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: { ok: false, error: { code: 'SESSION_CLOSED', message: 'closed', retryable: false } },
      }),
    ).toBe('genericAckErr:SESSION_CLOSED');
  });

  it('narrows the error frame', () => {
    expect(
      describeFrame({
        v: 1,
        t: 'error',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: { code: 'AUTH_EXPIRED', message: 'expired', retryable: true },
      }),
    ).toBe('error:AUTH_EXPIRED');
  });
});
