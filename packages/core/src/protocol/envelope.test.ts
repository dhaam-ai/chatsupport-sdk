import { describe, expect, it } from 'vitest';
import type { AckFrame, ErrorFrame, ErrorPayload, Frame } from './envelope.js';

// envelope.ts has no runtime logic of its own — these tests are the
// compile-time contract doubling as living documentation: if any of these
// literals stop satisfying their interface, `tsc` fails the build, which
// is the point (this is exactly the kind of drift §12.2 exists to prevent).

describe('Frame<T>', () => {
  it('accepts a concrete payload and keeps camelCase, string-typed fields', () => {
    interface Payload {
      content: string;
    }
    const frame: Frame<Payload> = {
      v: 1,
      t: 'message.send',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ts: Date.now(),
      d: { content: 'hello' },
    };
    expect(frame.t).toBe('message.send');
    expect(frame.d.content).toBe('hello');
  });
});

describe('AckFrame<T>', () => {
  it('models the ok:true branch merged with extra data', () => {
    interface Extra {
      seq: number;
    }
    const ack: AckFrame<Extra> = {
      v: 1,
      t: 'ack',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      ref: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ts: Date.now(),
      d: { ok: true, seq: 42 },
    };
    expect(ack.d.ok).toBe(true);
    if (ack.d.ok) {
      expect(ack.d.seq).toBe(42);
    }
  });

  it('models the ok:false branch carrying a structured ErrorPayload', () => {
    const ack: AckFrame<{ seq: number }> = {
      v: 1,
      t: 'ack',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      ref: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ts: Date.now(),
      d: { ok: false, error: { code: 'VALIDATION_FAILED', message: 'bad content', retryable: false } },
    };
    expect(ack.d.ok).toBe(false);
    if (!ack.d.ok) {
      expect(ack.d.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('ErrorFrame', () => {
  it('allows an absent ref (no single frame to blame)', () => {
    const frame: ErrorFrame = {
      v: 1,
      t: 'error',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ts: Date.now(),
      d: { code: 'PROTOCOL_VERSION_UNSUPPORTED', message: 'client too old', retryable: false },
    };
    expect(frame.ref).toBeUndefined();
  });

  it('allows a present ref correlating to the offending frame', () => {
    const payload: ErrorPayload = {
      code: 'SESSION_CLOSED',
      message: 'session already closed',
      retryable: false,
      details: { sessionId: 'sess_123' },
    };
    const frame: ErrorFrame = {
      v: 1,
      t: 'error',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      ref: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ts: Date.now(),
      d: payload,
    };
    expect(frame.ref).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(frame.d.details).toEqual({ sessionId: 'sess_123' });
  });
});
