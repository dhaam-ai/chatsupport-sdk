import { describe, expect, it } from 'vitest';
import { validateFrame, isFrame, isValidUlid, isIsoTimestamp, isKnownFrameType } from './validate.js';

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ULID_B = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const TS = 1_692_000_000_000;
const ISO = '2026-08-17T00:00:00.000Z';

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess_1',
    status: 'OPEN',
    mode: 'BOT',
    participants: [{ participantId: 'p1', type: 'CUSTOMER', lastReadAt: ISO }],
    createdAt: ISO,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Valid frames of every catalog type pass.
// -----------------------------------------------------------------------------

describe('validateFrame — valid frames of every type pass', () => {
  const validFrames: Array<[string, unknown]> = [
    [
      'connection.hello',
      { v: 1, t: 'connection.hello', id: ULID_A, ts: TS, d: { token: 'tok', publishableKey: 'pk_test_1', protocolVersion: 1 } },
    ],
    [
      'connection.hello with resumeFrom',
      { v: 1, t: 'connection.hello', id: ULID_A, ts: TS, d: { token: 'tok', publishableKey: 'pk_test_1', protocolVersion: 1, resumeFrom: 41 } },
    ],
    [
      'connection.hello as a guest (guestId, no token)',
      { v: 1, t: 'connection.hello', id: ULID_A, ts: TS, d: { guestId: 'guest_abc123', publishableKey: 'pk_test_1', protocolVersion: 1 } },
    ],
    ['connection.reauth', { v: 1, t: 'connection.reauth', id: ULID_A, ts: TS, d: { token: 'tok2' } }],
    ['session.join', { v: 1, t: 'session.join', id: ULID_A, ts: TS, d: { sessionId: 'sess_1' } }],
    ['session.leave', { v: 1, t: 'session.leave', id: ULID_A, ts: TS, d: {} }],
    ['session.requestAgent', { v: 1, t: 'session.requestAgent', id: ULID_A, ts: TS, d: {} }],
    ['session.requestAgent with reason', { v: 1, t: 'session.requestAgent', id: ULID_A, ts: TS, d: { reason: 'billing' } }],
    ['message.send', { v: 1, t: 'message.send', id: ULID_A, ts: TS, d: { content: 'hi', type: 'TEXT' } }],
    [
      'message.send with attachment metadata',
      {
        v: 1,
        t: 'message.send',
        id: ULID_A,
        ts: TS,
        d: {
          content: 'see attached',
          type: 'FILE',
          metadata: { attachment: { url: 'https://x/y', fileName: 'a.png', mimeType: 'image/png', size: 10, mediaType: 'image' } },
        },
      },
    ],
    ['message.markRead', { v: 1, t: 'message.markRead', id: ULID_A, ts: TS, d: {} }],
    ['message.markRead with upToMessageId', { v: 1, t: 'message.markRead', id: ULID_A, ts: TS, d: { upToMessageId: ULID_B } }],
    ['typing.start', { v: 1, t: 'typing.start', id: ULID_A, ts: TS, d: {} }],
    ['typing.stop', { v: 1, t: 'typing.stop', id: ULID_A, ts: TS, d: { participantId: 'p1' } }],
    ['presence.set', { v: 1, t: 'presence.set', id: ULID_A, ts: TS, d: { status: 'ONLINE' } }],
    ['presence.query', { v: 1, t: 'presence.query', id: ULID_A, ts: TS, d: {} }],
    ['presence.query with participantIds', { v: 1, t: 'presence.query', id: ULID_A, ts: TS, d: { participantIds: ['p1', 'p2'] } }],
    ['system.heartbeat', { v: 1, t: 'system.heartbeat', id: ULID_A, ts: TS, d: {} }],
    ['connection.ack', { v: 1, t: 'connection.ack', id: ULID_A, ts: TS, d: { protocolVersion: 1, seq: 10, session: baseSession() } }],
    ['session.updated', { v: 1, t: 'session.updated', id: ULID_A, ts: TS, d: { session: baseSession({ status: 'RESOLVED' }) } }],
    ['session.closed', { v: 1, t: 'session.closed', id: ULID_A, ts: TS, d: { sessionId: 'sess_1', closeReason: 'SWITCHED' } }],
    ['agent.joined', { v: 1, t: 'agent.joined', id: ULID_A, ts: TS, d: { agentId: 'agent_1', agentName: 'Ada' } }],
    ['agent.left', { v: 1, t: 'agent.left', id: ULID_A, ts: TS, d: { agentId: 'agent_1' } }],
    [
      'message.new',
      {
        v: 1,
        t: 'message.new',
        id: ULID_A,
        ts: TS,
        d: { id: ULID_B, sessionId: 'sess_1', senderId: 'p1', senderType: 'CUSTOMER', type: 'TEXT', content: 'hi', seq: 1, createdAt: ISO },
      },
    ],
    ['message.read', { v: 1, t: 'message.read', id: ULID_A, ts: TS, d: { participantId: 'agent_1', readAt: ISO } }],
    ['presence.update', { v: 1, t: 'presence.update', id: ULID_A, ts: TS, d: { participantId: 'p1', status: 'AWAY' } }],
    ['ticket.linked', { v: 1, t: 'ticket.linked', id: ULID_A, ts: TS, d: { ticketId: 'tk_1' } }],
    ['system.pong', { v: 1, t: 'system.pong', id: ULID_A, ts: TS, d: {} }],
    [
      'ack (ok:true)',
      { v: 1, t: 'ack', id: ULID_B, ref: ULID_A, ts: TS, d: { ok: true, seq: 5 } },
    ],
    [
      'ack (ok:false)',
      { v: 1, t: 'ack', id: ULID_B, ref: ULID_A, ts: TS, d: { ok: false, error: { code: 'VALIDATION_FAILED', message: 'bad', retryable: false } } },
    ],
    ['error without ref', { v: 1, t: 'error', id: ULID_A, ts: TS, d: { code: 'PROTOCOL_VERSION_UNSUPPORTED', message: 'too old', retryable: false } }],
    ['error with ref', { v: 1, t: 'error', id: ULID_B, ref: ULID_A, ts: TS, d: { code: 'AUTH_EXPIRED', message: 'expired', retryable: true } }],
  ];

  it.each(validFrames)('%s', (_label, input) => {
    const result = validateFrame(input);
    expect(result.ok).toBe(true);
    expect(isFrame(input)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Malformed frames are rejected with a useful reason.
// -----------------------------------------------------------------------------

describe('validateFrame — malformed frames rejected with a useful reason', () => {
  it('rejects non-object input', () => {
    const result = validateFrame('not a frame');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/must be a JSON object/);
      expect(result.path).toBe('');
    }
  });

  it('rejects null and arrays', () => {
    expect(validateFrame(null).ok).toBe(false);
    expect(validateFrame([1, 2, 3]).ok).toBe(false);
  });

  it('rejects a missing/non-integer v', () => {
    const result = validateFrame({ t: 'system.heartbeat', id: ULID_A, ts: TS, d: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('v');

    const result2 = validateFrame({ v: 1.5, t: 'system.heartbeat', id: ULID_A, ts: TS, d: {} });
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.path).toBe('v');
  });

  it('rejects a missing or empty t', () => {
    const result = validateFrame({ v: 1, id: ULID_A, ts: TS, d: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('t');

    const result2 = validateFrame({ v: 1, t: '', id: ULID_A, ts: TS, d: {} });
    expect(result2.ok).toBe(false);
  });

  it('rejects a malformed id (not a valid ULID)', () => {
    const result = validateFrame({ v: 1, t: 'system.heartbeat', id: 'not-a-ulid', ts: TS, d: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toBe('id');
      expect(result.reason).toMatch(/ULID/);
      expect(result.frameType).toBe('system.heartbeat');
    }
  });

  it('rejects a lowercase-only id, since canonical ULIDs are uppercase', () => {
    const result = validateFrame({ v: 1, t: 'system.heartbeat', id: ULID_A.toLowerCase(), ts: TS, d: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-numeric ts', () => {
    const result = validateFrame({ v: 1, t: 'system.heartbeat', id: ULID_A, ts: 'now', d: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('ts');
  });

  it('rejects a missing required payload field, with the reason naming the field', () => {
    const result = validateFrame({ v: 1, t: 'message.send', id: ULID_A, ts: TS, d: { content: 'hi' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toBe('d.type');
      expect(result.reason).toMatch(/MessageType/);
    }
  });

  it('rejects an invalid enum value in a payload', () => {
    const result = validateFrame({ v: 1, t: 'presence.set', id: ULID_A, ts: TS, d: { status: 'BUSY' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.status');
  });

  it('rejects a wrong-typed field (number where string expected)', () => {
    const result = validateFrame({ v: 1, t: 'session.join', id: ULID_A, ts: TS, d: { sessionId: 123 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.sessionId');
  });

  it('rejects a non-ISO-8601 timestamp field nested in a session snapshot', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.ack',
      id: ULID_A,
      ts: TS,
      d: { protocolVersion: 1, seq: 1, session: baseSession({ createdAt: '2026-08-17' }) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.session.createdAt');
  });

  it('rejects a bad entry inside a nested array (participants)', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.ack',
      id: ULID_A,
      ts: TS,
      d: {
        protocolVersion: 1,
        seq: 1,
        session: baseSession({ participants: [{ participantId: 'p1', type: 'NOT_A_TYPE' }] }),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.session.participants[0].type');
  });

  it('never returns a partial frame on failure', () => {
    const result = validateFrame({ v: 1, t: 'message.send', id: ULID_A, ts: TS, d: {} });
    expect(result.ok).toBe(false);
    expect((result as Record<string, unknown>)['frame']).toBeUndefined();
  });

  it('rejects a connection.hello with neither token nor guestId', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.hello',
      id: ULID_A,
      ts: TS,
      d: { publishableKey: 'pk_test_1', protocolVersion: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exactly one of token or guestId/);
  });

  it('rejects a connection.hello with both token and guestId', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.hello',
      id: ULID_A,
      ts: TS,
      d: { token: 'tok', guestId: 'guest_abc', publishableKey: 'pk_test_1', protocolVersion: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exactly one of token or guestId/);
  });

  it('rejects an ack frame with a missing ref', () => {
    const result = validateFrame({ v: 1, t: 'ack', id: ULID_A, ts: TS, d: { ok: true } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('ref');
  });

  it('rejects an ack frame whose ok:false branch has no valid error payload', () => {
    const result = validateFrame({ v: 1, t: 'ack', id: ULID_B, ref: ULID_A, ts: TS, d: { ok: false } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.error');
  });

  it('rejects an ack frame whose d.ok is not a boolean', () => {
    const result = validateFrame({ v: 1, t: 'ack', id: ULID_B, ref: ULID_A, ts: TS, d: { ok: 'yes' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.ok');
  });

  it('rejects an error frame with an invalid ErrorCode', () => {
    const result = validateFrame({ v: 1, t: 'error', id: ULID_A, ts: TS, d: { code: 'TOKEN_EXPIRED', message: 'x', retryable: true } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.code');
  });

  it('rejects an error frame with a malformed ref', () => {
    const result = validateFrame({
      v: 1,
      t: 'error',
      id: ULID_A,
      ref: 'nope',
      ts: TS,
      d: { code: 'INTERNAL', message: 'x', retryable: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('ref');
  });

  it('rejects a connection.ack whose replay array contains a client-originated frame', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.ack',
      id: ULID_A,
      ts: TS,
      d: {
        protocolVersion: 1,
        seq: 2,
        session: baseSession(),
        replay: [{ v: 1, t: 'message.send', id: ULID_B, ts: TS, d: { content: 'hi', type: 'TEXT' } }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toBe('d.replay[0].t');
      expect(result.reason).toMatch(/server push frame type/);
    }
  });

  it('rejects a connection.ack whose replay array contains a malformed frame, with a nested path', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.ack',
      id: ULID_A,
      ts: TS,
      d: {
        protocolVersion: 1,
        seq: 2,
        session: baseSession(),
        replay: [{ v: 1, t: 'message.new', id: ULID_B, ts: TS, d: { id: ULID_B } }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.replay[0].d.sessionId');
  });

  it('accepts a connection.ack whose replay array contains valid server push frames', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.ack',
      id: ULID_A,
      ts: TS,
      d: {
        protocolVersion: 1,
        seq: 2,
        session: baseSession(),
        replay: [
          {
            v: 1,
            t: 'message.new',
            id: ULID_B,
            ts: TS,
            d: { id: ULID_B, sessionId: 'sess_1', senderId: 'p1', senderType: 'CUSTOMER', type: 'TEXT', content: 'hi', seq: 1, createdAt: ISO },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Unknown frame types are rejected, not passed through.
// -----------------------------------------------------------------------------

describe('validateFrame — unknown frame types rejected, not passed through', () => {
  it('rejects a frame type this module has never heard of', () => {
    const result = validateFrame({ v: 1, t: 'chat.message.receive', id: ULID_A, ts: TS, d: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toBe('t');
      expect(result.reason).toMatch(/unknown frame type/);
      // Since t itself is unrecognized, this module cannot vouch for it as
      // a known frameType either — frameType is deliberately absent here.
      expect(result.frameType).toBeUndefined();
    }
  });

  it('rejects a v1-era frame name even though it is a plausible-looking string', () => {
    expect(validateFrame({ v: 1, t: 'TYPING_INDICATOR', id: ULID_A, ts: TS, d: {} }).ok).toBe(false);
  });

  it('does not partially apply an unknown-type frame — isFrame is false, not "trust it anyway"', () => {
    expect(isFrame({ v: 1, t: 'made.up', id: ULID_A, ts: TS, d: { anything: 'goes' } })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Forward compatibility: unrecognized EXTRA fields are tolerated, not rejected.
// -----------------------------------------------------------------------------

describe('validateFrame — tolerates unknown extra fields (forward compatible)', () => {
  it('accepts an extra top-level field the client does not understand yet', () => {
    const result = validateFrame({ v: 1, t: 'system.heartbeat', id: ULID_A, ts: TS, d: {}, futureField: 'ignored' });
    expect(result.ok).toBe(true);
  });

  it('accepts an extra field inside d that is not part of the documented payload', () => {
    const result = validateFrame({ v: 1, t: 'session.join', id: ULID_A, ts: TS, d: { sessionId: 'sess_1', futureHint: 42 } });
    expect(result.ok).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Small standalone guards.
// -----------------------------------------------------------------------------

describe('isValidUlid', () => {
  it('accepts a canonical 26-char Crockford base32 ULID', () => {
    expect(isValidUlid(ULID_A)).toBe(true);
  });

  it('rejects wrong length, invalid characters (I, L, O, U), and non-strings', () => {
    expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false); // 25 chars
    expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FAVX')).toBe(false); // 27 chars
    expect(isValidUlid('IIIIIIIIIIIIIIIIIIIIIIIIII')).toBe(false); // contains I
    expect(isValidUlid(123)).toBe(false);
  });
});

describe('isIsoTimestamp', () => {
  it('accepts ISO-8601 with Z and with an explicit offset', () => {
    expect(isIsoTimestamp('2026-08-17T00:00:00.000Z')).toBe(true);
    expect(isIsoTimestamp('2026-08-17T00:00:00+05:30')).toBe(true);
  });

  it('rejects epoch millis, bare dates, and non-ISO formats', () => {
    expect(isIsoTimestamp(TS)).toBe(false);
    expect(isIsoTimestamp('2026-08-17')).toBe(false);
    expect(isIsoTimestamp('08/17/2026')).toBe(false);
  });
});

describe('isKnownFrameType', () => {
  it('recognizes every catalog member and rejects everything else', () => {
    expect(isKnownFrameType('message.send')).toBe(true);
    expect(isKnownFrameType('message.receive')).toBe(false);
  });
});
