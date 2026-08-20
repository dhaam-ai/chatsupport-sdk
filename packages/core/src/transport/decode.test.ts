import { describe, expect, it } from 'vitest';

import { decodeFrame } from './decode.js';

const ID_A = '01J0000000000000000000000A';
const ID_B = '01J0000000000000000000000B';

/** A well-formed server push frame, as JSON text. */
function text(value: unknown): string {
  return JSON.stringify(value);
}

const pong = { v: 1, t: 'system.pong', id: ID_A, ts: 1_700_000_000_000, d: {} };

describe('decodeFrame', () => {
  describe('the text gate', () => {
    it('accepts a JSON text frame', () => {
      const result = decodeFrame(text(pong));

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.frame.t).toBe('system.pong');
    });

    // D4: binary is rejected, never decoded-and-retried.
    it('rejects binary payloads without attempting to coerce them', () => {
      const result = decodeFrame(new ArrayBuffer(8));

      expect(result).toMatchObject({ ok: false, path: '', reason: expect.stringContaining('binary data') });
    });

    it('rejects non-string payloads of every other shape', () => {
      for (const data of [null, undefined, 42, true, { t: 'system.pong' }, [1, 2]]) {
        const result = decodeFrame(data);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain('expected a text frame');
      }
    });

    it('names the offending type without echoing the value', () => {
      const result = decodeFrame(12345);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).not.toContain('12345');
    });
  });

  describe('the JSON gate', () => {
    it('rejects malformed JSON', () => {
      const result = decodeFrame('{"v":1,"t":');

      expect(result).toMatchObject({ ok: false, path: '', reason: 'frame is not valid JSON' });
    });

    it('rejects a bare JSON scalar', () => {
      expect(decodeFrame('"just a string"').ok).toBe(false);
      expect(decodeFrame('null').ok).toBe(false);
      expect(decodeFrame('[]').ok).toBe(false);
    });

    it('carries the raw payload on a parse failure', () => {
      const result = decodeFrame('not json at all');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.raw).toBe('not json at all');
    });
  });

  describe('the validation gate', () => {
    it('rejects an unknown frame type', () => {
      const result = decodeFrame(text({ ...pong, t: 'message.telepathy' }));

      expect(result).toMatchObject({ ok: false, path: 't' });
      if (!result.ok) expect(result.reason).toContain('unknown frame type');
    });

    it('rejects a non-ULID envelope id', () => {
      const result = decodeFrame(text({ ...pong, id: 'not-a-ulid' }));

      expect(result).toMatchObject({ ok: false, path: 'id' });
    });

    it('rejects a lowercase ULID, matching the server', () => {
      const result = decodeFrame(text({ ...pong, id: ID_A.toLowerCase() }));

      expect(result).toMatchObject({ ok: false, path: 'id' });
    });

    it('rejects a missing protocol version', () => {
      const { v: _v, ...withoutVersion } = pong;
      const result = decodeFrame(text(withoutVersion));

      expect(result).toMatchObject({ ok: false, path: 'v' });
    });

    it('reports the failing field path for a bad payload', () => {
      const result = decodeFrame(
        text({
          v: 1,
          t: 'message.new',
          id: ID_A,
          ts: 1,
          d: {
            id: ID_B,
            sessionId: 's1',
            senderId: 'u1',
            senderType: 'CUSTOMER',
            type: 'TEXT',
            content: 'hi',
            seq: 'not-a-number',
            createdAt: '2026-08-18T00:00:00Z',
          },
        }),
      );

      expect(result).toMatchObject({ ok: false, path: 'd.seq' });
    });

    // Forward compatibility: the backend must be able to add fields.
    it('accepts unrecognized extra fields', () => {
      const result = decodeFrame(text({ ...pong, futureField: 'ok', d: { alsoNew: 1 } }));

      expect(result.ok).toBe(true);
    });
  });

  describe('the direction gate', () => {
    it('rejects a client→server frame arriving from the server', () => {
      const hello = {
        v: 1,
        t: 'connection.hello',
        id: ID_A,
        ts: 1,
        d: { token: 't', publishableKey: 'pk', protocolVersion: 1 },
      };

      const result = decodeFrame(text(hello));

      expect(result).toMatchObject({ ok: false, path: 't' });
      if (!result.ok) expect(result.reason).toContain('client→server frame type');
    });

    it('rejects every client-only frame type', () => {
      const clientOnly = [
        'connection.hello',
        'connection.reauth',
        'session.join',
        'session.leave',
        'session.requestAgent',
        'message.send',
        'message.markRead',
        'presence.set',
        'presence.query',
        'system.heartbeat',
      ];

      for (const t of clientOnly) {
        const result = decodeFrame(text({ v: 1, t, id: ID_A, ts: 1, d: {} }));
        expect(result.ok).toBe(false);
      }
    });

    // §7.3: one concept, one pair of names, in both directions.
    it('accepts the two frame types that legitimately travel both ways', () => {
      for (const t of ['typing.start', 'typing.stop']) {
        const result = decodeFrame(text({ v: 1, t, id: ID_A, ts: 1, d: { participantId: 'u1' } }));
        expect(result.ok).toBe(true);
      }
    });

    it('accepts every server push frame type it is given a valid payload for', () => {
      const cases: Array<[string, unknown]> = [
        ['session.closed', { sessionId: 's1', closeReason: 'RESOLVED' }],
        ['agent.joined', { kind: 'AGENT', id: 'a1', displayName: 'Ada' }],
        ['agent.left', { kind: 'AGENT', id: 'a1', displayName: 'Ada' }],
        ['message.read', { participantId: 'u1', readAt: '2026-08-18T00:00:00Z' }],
        ['ticket.linked', { ticketId: 'tk1' }],
        ['system.pong', {}],
      ];

      for (const [t, d] of cases) {
        const result = decodeFrame(text({ v: 1, t, id: ID_A, ts: 1, d }));
        expect(result.ok, `${t} should decode`).toBe(true);
      }
    });
  });

  describe('the two special envelope shapes', () => {
    it('decodes a successful ack and keeps its ref', () => {
      const result = decodeFrame(text({ v: 1, t: 'ack', id: ID_A, ref: ID_B, ts: 1, d: { ok: true, seq: 13 } }));

      expect(result.ok).toBe(true);
      if (result.ok && result.frame.t === 'ack') {
        expect(result.frame.ref).toBe(ID_B);
        expect(result.frame.d).toEqual({ ok: true, seq: 13 });
      }
    });

    it('decodes a rejecting ack', () => {
      const result = decodeFrame(
        text({
          v: 1,
          t: 'ack',
          id: ID_A,
          ref: ID_B,
          ts: 1,
          d: { ok: false, error: { code: 'SESSION_CLOSED', message: 'closed', retryable: false } },
        }),
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.frame.t === 'ack' && result.frame.d.ok === false) {
        expect(result.frame.d.error.code).toBe('SESSION_CLOSED');
      }
    });

    it('rejects an ack with no ref, which could never be correlated', () => {
      const result = decodeFrame(text({ v: 1, t: 'ack', id: ID_A, ts: 1, d: { ok: true } }));

      expect(result).toMatchObject({ ok: false, path: 'ref' });
    });

    it('decodes an error frame with a ref', () => {
      const result = decodeFrame(
        text({
          v: 1,
          t: 'error',
          id: ID_A,
          ref: ID_B,
          ts: 1,
          d: { code: 'VALIDATION_FAILED', message: 'd.content: must be a string', retryable: false },
        }),
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.frame.t === 'error') {
        expect(result.frame.ref).toBe(ID_B);
        expect(result.frame.d.retryable).toBe(false);
      }
    });

    // The server omits `ref` whenever validation failed before `id` was
    // reached — a bad `t`, `v` or `id` is unattributable by design.
    it('decodes an error frame with no ref', () => {
      const result = decodeFrame(
        text({
          v: 1,
          t: 'error',
          id: ID_A,
          ts: 1,
          d: { code: 'VALIDATION_FAILED', message: 'Frame is not valid JSON', retryable: false },
        }),
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.frame.t === 'error') expect(result.frame.ref).toBeUndefined();
    });

    it('rejects an error frame carrying an unknown error code', () => {
      const result = decodeFrame(
        text({
          v: 1,
          t: 'error',
          id: ID_A,
          ts: 1,
          d: { code: 'TOKEN_EXPIRED', message: 'v1 style', retryable: false },
        }),
      );

      expect(result.ok).toBe(false);
    });
  });

  it('never throws, whatever it is handed', () => {
    const nasty: unknown[] = [
      undefined,
      null,
      Symbol('x'),
      () => undefined,
      '{"__proto__":{"polluted":true}}',
      '{"v":1,"t":"system.pong","id":"' + ID_A + '","ts":1,"d":null}',
      ' ',
      '{'.repeat(1000),
    ];

    for (const value of nasty) {
      expect(() => decodeFrame(value)).not.toThrow();
    }
  });
});
