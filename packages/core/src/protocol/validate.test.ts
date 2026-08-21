import { describe, expect, it } from 'vitest';
import { validateFrame, isFrame, isValidUlid, isValidMessageId, isIsoTimestamp, isKnownFrameType } from './validate.js';

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ULID_B = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
// A real bot-reply id, straight off chat-service-node: messages the backend
// mints itself (bot replies, system messages) never carry a client ULID and
// get the database's UUID default instead.
const UUID_BOT = 'b19afa49-5628-41fd-883b-e2182bf17978';
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
      { v: 1, t: 'connection.hello', id: ULID_A, ts: TS, d: { token: 'tok', publishableKey: 'dhp_test_1', protocolVersion: 1 } },
    ],
    [
      'connection.hello with resumeFrom',
      { v: 1, t: 'connection.hello', id: ULID_A, ts: TS, d: { token: 'tok', publishableKey: 'dhp_test_1', protocolVersion: 1, resumeFrom: 41 } },
    ],
    ['connection.reauth', { v: 1, t: 'connection.reauth', id: ULID_A, ts: TS, d: { token: 'tok2' } }],
    ['session.join', { v: 1, t: 'session.join', id: ULID_A, ts: TS, d: { sessionId: 'sess_1' } }],
    ['session.leave', { v: 1, t: 'session.leave', id: ULID_A, ts: TS, d: {} }],
    ['session.requestAgent', { v: 1, t: 'session.requestAgent', id: ULID_A, ts: TS, d: {} }],
    ['session.requestAgent with reason', { v: 1, t: 'session.requestAgent', id: ULID_A, ts: TS, d: { reason: 'billing' } }],
    ['message.send', { v: 1, t: 'message.send', id: ULID_A, ts: TS, d: { content: 'hi', type: 'TEXT' } }],
    [
      'message.send with a top-level attachment',
      {
        v: 1,
        t: 'message.send',
        id: ULID_A,
        ts: TS,
        d: {
          content: 'see attached',
          type: 'FILE',
          attachment: { url: 'https://x/y', fileName: 'a.png', mimeType: 'image/png', size: 10, mediaType: 'image' },
        },
      },
    ],
    ['message.markRead', { v: 1, t: 'message.markRead', id: ULID_A, ts: TS, d: {} }],
    ['message.markRead with upToMessageId', { v: 1, t: 'message.markRead', id: ULID_A, ts: TS, d: { upToMessageId: ULID_B } }],
    ['message.markDelivered', { v: 1, t: 'message.markDelivered', id: ULID_A, ts: TS, d: { upToSeq: 42 } }],
    ['message.markDelivered at seq 0', { v: 1, t: 'message.markDelivered', id: ULID_A, ts: TS, d: { upToSeq: 0 } }],
    ['typing.start', { v: 1, t: 'typing.start', id: ULID_A, ts: TS, d: {} }],
    ['typing.stop', { v: 1, t: 'typing.stop', id: ULID_A, ts: TS, d: { participantId: 'p1' } }],
    ['presence.set', { v: 1, t: 'presence.set', id: ULID_A, ts: TS, d: { status: 'ONLINE' } }],
    ['presence.query', { v: 1, t: 'presence.query', id: ULID_A, ts: TS, d: {} }],
    ['presence.query with participantIds', { v: 1, t: 'presence.query', id: ULID_A, ts: TS, d: { participantIds: ['p1', 'p2'] } }],
    ['system.heartbeat', { v: 1, t: 'system.heartbeat', id: ULID_A, ts: TS, d: {} }],
    ['connection.ack', { v: 1, t: 'connection.ack', id: ULID_A, ts: TS, d: { protocolVersion: 1, seq: 10, session: baseSession() } }],
    ['session.updated', { v: 1, t: 'session.updated', id: ULID_A, ts: TS, d: { session: baseSession({ status: 'RESOLVED' }) } }],
    ['session.closed', { v: 1, t: 'session.closed', id: ULID_A, ts: TS, d: { sessionId: 'sess_1', closeReason: 'SWITCHED' } }],
    ['agent.joined', { v: 1, t: 'agent.joined', id: ULID_A, ts: TS, d: { kind: 'AGENT', id: 'agent_1', displayName: 'Ada' } }],
    ['agent.left', { v: 1, t: 'agent.left', id: ULID_A, ts: TS, d: { kind: 'AGENT', id: 'agent_1', displayName: 'Ada' } }],
    ['agent.joined with kind BOT', { v: 1, t: 'agent.joined', id: ULID_A, ts: TS, d: { kind: 'BOT', id: 'bot_1', displayName: 'Botty' } }],
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
    [
      'message.new from the bot, whose id is a server-minted UUID rather than a client ULID',
      {
        v: 1,
        t: 'message.new',
        id: ULID_A,
        ts: TS,
        d: { id: UUID_BOT, sessionId: 'sess_1', senderId: 'ai-bot', senderType: 'BOT', type: 'TEXT', content: 'Hello! How can I assist you today?', seq: 14, createdAt: ISO },
      },
    ],
    ['message.read', { v: 1, t: 'message.read', id: ULID_A, ts: TS, d: { participantId: 'agent_1', readAt: ISO } }],
    [
      'message.delivered',
      { v: 1, t: 'message.delivered', id: ULID_A, ts: TS, d: { participantId: 'agent_1', deliveredUpToSeq: 7, deliveredAt: ISO } },
    ],
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

  // The bug this guards: a single bot reply inside the replay window made
  // `validateReplayFrame` fail, which fails the WHOLE `connection.ack` — so a
  // session that had ever seen the bot could not complete a resume handshake
  // at all, and the widget showed nothing rather than one missing bubble.
  it('accepts a connection.ack whose replay contains a bot message with a UUID id', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.ack',
      id: ULID_A,
      ts: TS,
      d: {
        protocolVersion: 1,
        seq: 14,
        session: baseSession(),
        replay: [
          {
            v: 1,
            t: 'message.new',
            id: ULID_B,
            ts: TS,
            d: { id: UUID_BOT, sessionId: 'sess_1', senderId: 'ai-bot', senderType: 'BOT', type: 'TEXT', content: 'hi', seq: 14, createdAt: ISO },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
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

  // Accepting an extra field and PRESERVING it are different guarantees, and
  // only the second one is usable. `MessageSendAckData.senderType` is the
  // concrete case: the server excludes a sender from its own `message.new`
  // fan-out, so this ack is the only frame that tells a client how its message
  // was actually labelled — a validator that rebuilt `d` as a bare
  // `{ ok: true }` would accept the frame and silently drop the answer.
  it("preserves the send-ack's extra data, so senderType survives validation", () => {
    const result = validateFrame({
      v: 1,
      t: 'ack',
      id: ULID_B,
      ref: ULID_A,
      ts: TS,
      d: { ok: true, seq: 5, senderType: 'AGENT' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frame.d).toEqual({ ok: true, seq: 5, senderType: 'AGENT' });
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

// D4 requires exactly one canonical location per concept. v1's bug was reading
// `message.attachment` and `message.metadata.attachment` interchangeably
// (§12.2), and T1/T2 briefly reintroduced it by disagreeing across transports.
// These lock the resolution in: top level, validated; under `metadata`, opaque.
describe('attachment has exactly one canonical location (D4)', () => {
  const attachment = { url: 'https://x/y', fileName: 'a.png', mimeType: 'image/png', size: 10, mediaType: 'image' };
  const send = (d: Record<string, unknown>) => ({ v: 1, t: 'message.send', id: ULID_A, ts: TS, d });

  it('validates a top-level attachment', () => {
    expect(validateFrame(send({ content: 'x', type: 'FILE', attachment })).ok).toBe(true);
  });

  it('rejects a malformed top-level attachment', () => {
    const result = validateFrame(send({ content: 'x', type: 'FILE', attachment: { url: 'https://x/y' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toContain('attachment');
  });

  it('does not interpret metadata.attachment — it is opaque application data', () => {
    // Deliberately malformed *as an attachment*. It must still pass, because
    // inside `metadata` it is just an app-defined key core never reads.
    expect(validateFrame(send({ content: 'x', type: 'FILE', metadata: { attachment: { nonsense: true } } })).ok).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// The delivery pair. `seq` is the ordering key (D2), so the two fields that
// carry one must be integers or the frame is not applied at all — a watermark
// built from a string or a float cannot be compared against `ChatMessage.seq`.
// -----------------------------------------------------------------------------

describe('delivery frames — message.markDelivered / message.delivered', () => {
  const markDelivered = (d: unknown) => ({ v: 1, t: 'message.markDelivered', id: ULID_A, ts: TS, d });
  const delivered = (d: unknown) => ({ v: 1, t: 'message.delivered', id: ULID_A, ts: TS, d });

  it('rejects markDelivered with no upToSeq — unlike markRead, it is required', () => {
    const result = validateFrame(markDelivered({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toBe('d.upToSeq');
      expect(result.frameType).toBe('message.markDelivered');
    }
  });

  it.each([
    ['a string', '5'],
    ['a float', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
  ])('rejects markDelivered whose upToSeq is %s', (_label, upToSeq) => {
    const result = validateFrame(markDelivered({ upToSeq }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.upToSeq');
  });

  it('rejects a delivered push missing each required field in turn', () => {
    const full = { participantId: 'agent_1', deliveredUpToSeq: 3, deliveredAt: ISO };

    for (const key of ['participantId', 'deliveredUpToSeq', 'deliveredAt'] as const) {
      const { [key]: _omitted, ...rest } = full;
      const result = validateFrame(delivered(rest));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.path).toBe(`d.${key}`);
    }
  });

  it('rejects a delivered push whose deliveredUpToSeq is not an integer', () => {
    const result = validateFrame(
      delivered({ participantId: 'agent_1', deliveredUpToSeq: '3', deliveredAt: ISO }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.deliveredUpToSeq');
  });

  it('rejects a delivered push whose deliveredAt is not ISO-8601', () => {
    const result = validateFrame(
      delivered({ participantId: 'agent_1', deliveredUpToSeq: 3, deliveredAt: '2024-01-01' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.deliveredAt');
  });

  it('accepts a delivered push carrying an unknown extra field (forward compatible)', () => {
    expect(
      validateFrame(
        delivered({ participantId: 'agent_1', deliveredUpToSeq: 3, deliveredAt: ISO, deliveredBy: 'future' }),
      ).ok,
    ).toBe(true);
  });

  it('accepts message.delivered as a replayed frame inside connection.ack', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.ack',
      id: ULID_A,
      ts: TS,
      d: {
        protocolVersion: 1,
        seq: 10,
        session: baseSession(),
        replay: [delivered({ participantId: 'agent_1', deliveredUpToSeq: 3, deliveredAt: ISO })],
      },
    });
    expect(result.ok).toBe(true);
  });

  it('refuses markDelivered inside a replay array — it is not a server push', () => {
    const result = validateFrame({
      v: 1,
      t: 'connection.ack',
      id: ULID_A,
      ts: TS,
      d: {
        protocolVersion: 1,
        seq: 10,
        session: baseSession(),
        replay: [markDelivered({ upToSeq: 3 })],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/server push frame type/);
  });
});

// -----------------------------------------------------------------------------
// v2 wire contract: SessionSnapshot.handledBy, ParticipantSnapshot.displayName,
// and AgentEventPayload = HandledBy (§ T7). See domain.ts's `HandledBy` doc
// comment for the semantics ("absent" never means "nobody is handling this").
// -----------------------------------------------------------------------------

describe('HandledBy — SessionSnapshot.handledBy, ParticipantSnapshot.displayName, agent.joined/left', () => {
  const ack = (d: unknown) => ({ v: 1, t: 'connection.ack', id: ULID_A, ts: TS, d });
  const agentJoined = (d: unknown) => ({ v: 1, t: 'agent.joined', id: ULID_A, ts: TS, d });
  const agentLeft = (d: unknown) => ({ v: 1, t: 'agent.left', id: ULID_A, ts: TS, d });

  it('accepts a session snapshot with handledBy kind AGENT', () => {
    const result = validateFrame(
      ack({ protocolVersion: 1, seq: 1, session: baseSession({ handledBy: { kind: 'AGENT', id: 'p1', displayName: 'Ada' } }) }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a session snapshot with handledBy kind BOT', () => {
    const result = validateFrame(
      ack({ protocolVersion: 1, seq: 1, session: baseSession({ handledBy: { kind: 'BOT', id: 'bot_1', displayName: 'Botty' } }) }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a session snapshot with handledBy entirely absent', () => {
    const result = validateFrame(ack({ protocolVersion: 1, seq: 1, session: baseSession() }));
    expect(result.ok).toBe(true);
  });

  it('rejects a handledBy whose kind is outside the AGENT|BOT union', () => {
    const result = validateFrame(
      ack({ protocolVersion: 1, seq: 1, session: baseSession({ handledBy: { kind: 'CUSTOMER', id: 'p1', displayName: 'Ada' } }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.session.handledBy.kind');
  });

  it.each([
    ['null', null],
    ['empty string', ''],
  ])('rejects a session participant displayName of %s', (_label, displayName) => {
    const result = validateFrame(
      ack({
        protocolVersion: 1,
        seq: 1,
        session: baseSession({ participants: [{ participantId: 'p1', type: 'CUSTOMER', displayName }] }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.session.participants[0].displayName');
  });

  it('accepts a session participant with displayName present', () => {
    const result = validateFrame(
      ack({
        protocolVersion: 1,
        seq: 1,
        session: baseSession({ participants: [{ participantId: 'p1', type: 'CUSTOMER', displayName: 'Grace' }] }),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a session participant with displayName absent', () => {
    // baseSession()'s default participant already carries no displayName —
    // asserted explicitly here so the additive contract has its own test.
    const result = validateFrame(ack({ protocolVersion: 1, seq: 1, session: baseSession() }));
    expect(result.ok).toBe(true);
  });

  it('validates agent.joined and agent.left under the new HandledBy shape', () => {
    expect(validateFrame(agentJoined({ kind: 'AGENT', id: 'agent_1', displayName: 'Ada' })).ok).toBe(true);
    expect(validateFrame(agentLeft({ kind: 'AGENT', id: 'agent_1', displayName: 'Ada' })).ok).toBe(true);
    expect(validateFrame(agentJoined({ kind: 'BOT', id: 'bot_1', displayName: 'Botty' })).ok).toBe(true);
  });

  it('rejects agent.joined whose kind is outside the AGENT|BOT union', () => {
    const result = validateFrame(agentJoined({ kind: 'SUPERVISOR', id: 'agent_1', displayName: 'Ada' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.kind');
  });

  it('rejects agent.joined/left missing displayName — required on HandledBy, unlike the old agentName', () => {
    const joined = validateFrame(agentJoined({ kind: 'AGENT', id: 'agent_1' }));
    expect(joined.ok).toBe(false);
    if (!joined.ok) expect(joined.path).toBe('d.displayName');

    const left = validateFrame(agentLeft({ kind: 'AGENT', id: 'agent_1' }));
    expect(left.ok).toBe(false);
    if (!left.ok) expect(left.path).toBe('d.displayName');
  });

  it.each([
    ['null', null],
    ['empty string', ''],
  ])('rejects agent.joined whose displayName is %s', (_label, displayName) => {
    const result = validateFrame(agentJoined({ kind: 'AGENT', id: 'agent_1', displayName }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.displayName');
  });

  it('an old-server payload with neither handledBy nor any participant displayName still validates and connects', () => {
    // baseSession() is exactly what a pre-v2 server would have sent: no
    // handledBy, no participant displayName. Additive evolution (One-Version
    // Rule) requires this to keep working unmodified.
    const result = validateFrame({
      v: 1,
      t: 'connection.ack',
      id: ULID_A,
      ts: TS,
      d: { protocolVersion: 1, seq: 1, session: baseSession() },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.t === 'connection.ack') {
      expect(result.frame.d.session.handledBy).toBeUndefined();
      expect(result.frame.d.session.participants[0]?.displayName).toBeUndefined();
    }
  });
});

// -----------------------------------------------------------------------------
// Message ids: ULID or UUID, and nothing looser.
// -----------------------------------------------------------------------------

describe('isValidMessageId', () => {
  it('accepts a client-originated ULID', () => {
    expect(isValidMessageId(ULID_A)).toBe(true);
  });

  it('accepts a server-minted UUID, in either case', () => {
    expect(isValidMessageId(UUID_BOT)).toBe(true);
    expect(isValidMessageId(UUID_BOT.toUpperCase())).toBe(true);
  });

  it('still rejects anything that is neither', () => {
    for (const bad of ['', 'not-an-id', '01ARZ3NDEKTSV4RRFFQ69G5FA', 'b19afa49-5628-41fd-883b', 42, null, undefined, {}]) {
      expect(isValidMessageId(bad)).toBe(false);
    }
  });

  it('leaves isValidUlid strict — envelope ids and ack refs are unchanged', () => {
    expect(isValidUlid(UUID_BOT)).toBe(false);
    expect(isValidUlid(ULID_A)).toBe(true);
  });
});

describe('validateFrame — message.new id shapes', () => {
  const message = (id: unknown) => ({
    v: 1,
    t: 'message.new',
    id: ULID_A,
    ts: TS,
    d: { id, sessionId: 'sess_1', senderId: 'ai-bot', senderType: 'BOT', type: 'TEXT', content: 'hi', seq: 14, createdAt: ISO },
  });

  it('accepts a bot reply carrying a UUID id', () => {
    expect(validateFrame(message(UUID_BOT)).ok).toBe(true);
  });

  it('rejects an id that is neither a ULID nor a UUID, and says so', () => {
    const result = validateFrame(message('not-an-id'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toBe('d.id');
      expect(result.reason).toBe('must be a valid ULID or UUID');
    }
  });
});

// -----------------------------------------------------------------------------
// `message.send.sessionId` — the addressing field (ROOT B).
//
// A `message.send` had no session on the wire at all: the server filed it under
// whatever `session.join` last set on the connection. A queued send that was
// authored in session B and flushed after the client had switched to session A
// was therefore delivered INTO session A — silent cross-conversation leakage,
// not a rendering glitch.
//
// The field is OPTIONAL on purpose. An older client that omits it must keep
// working exactly as before (server attributes to the joined session), so
// adding it is not a breaking wire change. What is NOT optional is its shape:
// an empty or non-string session id is a malformed address, and a malformed
// address must be refused at the edge rather than silently ignored — ignoring
// it degrades straight back to "file it wherever the connection happens to be
// joined", which is the exact bug this field exists to remove.
// -----------------------------------------------------------------------------
describe('message.send addresses its own session (ROOT B)', () => {
  const send = (d: Record<string, unknown>) => ({ v: 1, t: 'message.send', id: ULID_A, ts: TS, d });

  it('accepts a message.send carrying an explicit sessionId', () => {
    expect(validateFrame(send({ content: 'hi', type: 'TEXT', sessionId: 'sess_b' })).ok).toBe(true);
  });

  it('still accepts a message.send with no sessionId — the field is optional (older clients)', () => {
    expect(validateFrame(send({ content: 'hi', type: 'TEXT' })).ok).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['a number', 7],
    ['null', null],
    ['an object', { id: 'sess_b' }],
  ])('rejects a message.send whose sessionId is %s', (_label, sessionId) => {
    const result = validateFrame(send({ content: 'hi', type: 'TEXT', sessionId }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toBe('d.sessionId');
      expect(result.frameType).toBe('message.send');
    }
  });
});
