import { describe, expect, it } from 'vitest';

import type { AnyFrame } from '../protocol/index.js';
import { decodeFrame, encodeFrame } from './frame-codec.js';

function validFrame(): AnyFrame {
  return { v: 1, t: 'system.heartbeat', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', ts: 1_700_000_000_000, d: {} };
}

describe('encodeFrame / decodeFrame', () => {
  it('round-trips a valid frame through encode then decode', () => {
    const frame = validFrame();

    const result = decodeFrame(encodeFrame(frame));

    expect(result).toEqual({ ok: true, frame });
  });

  it('produces plain JSON text from encodeFrame', () => {
    const encoded = encodeFrame(validFrame());

    expect(() => JSON.parse(encoded)).not.toThrow();
    expect(typeof encoded).toBe('string');
  });

  it('reports a validation failure — not a thrown error — for malformed JSON', () => {
    const result = decodeFrame('not json {{{');

    expect(result).toEqual({ ok: false, path: '', reason: 'not valid JSON' });
  });

  it('reports a validation failure for well-formed JSON that is not a valid frame', () => {
    const result = decodeFrame(JSON.stringify({ hello: 'world' }));

    expect(result.ok).toBe(false);
  });

  it('delegates real frame-shape validation to protocol/validate.ts (unknown frame type is rejected)', () => {
    const result = decodeFrame(JSON.stringify({ v: 1, t: 'not.a.real.type', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', ts: 1, d: {} }));

    expect(result.ok).toBe(false);
  });
});
