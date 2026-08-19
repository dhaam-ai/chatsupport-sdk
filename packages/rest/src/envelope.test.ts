import { describe, expect, it } from 'vitest';

import { unwrapEnvelope } from './envelope.js';
import { RestApiError } from './errors.js';

describe('unwrapEnvelope', () => {
  it('returns the bare payload from a successful envelope', () => {
    const data = unwrapEnvelope<{ messages: unknown[]; hasMore: boolean }>(
      { success: true, data: { messages: [], hasMore: false } },
      'GET /chat/sessions/{sessionId}/messages',
    );

    expect(data).toEqual({ messages: [], hasMore: false });
  });

  it('rejects a body that is not enveloped at all', () => {
    // The defect this exists to catch: the adapters used to read fields off the
    // top level, so an unenveloped body yielded an empty page instead of an error.
    expect(() => unwrapEnvelope({ messages: [{ id: 'm1' }], hasMore: true }, 'ctx')).toThrow(
      RestApiError,
    );
  });

  it.each([
    ['success is false', { success: false, data: {} }],
    ['success is missing', { data: {} }],
    ['success is a truthy non-true value', { success: 1, data: {} }],
    ['data is missing', { success: true }],
    ['data is null', { success: true, data: null }],
    ['data is a string', { success: true, data: 'ok' }],
    ['data is an array', { success: true, data: [] }],
    ['the body is null', null],
    ['the body is a string', 'not json at all'],
  ])('rejects when %s', (_label, body) => {
    expect(() => unwrapEnvelope(body, 'ctx')).toThrow(RestApiError);
  });

  it('reports a non-retryable MALFORMED_RESPONSE, since a retry cannot reshape a body', () => {
    const error: unknown = (() => {
      try {
        unwrapEnvelope({}, 'ctx');
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();

    expect(error).toMatchObject({
      name: 'RestApiError',
      code: 'MALFORMED_RESPONSE',
      status: 200,
      retryable: false,
    });
  });

  it('names the route so the failure is locatable', () => {
    expect(() => unwrapEnvelope({}, 'POST /upload')).toThrow(/POST \/upload/);
  });

  it('never echoes the response body — it can carry signed URLs (§14)', () => {
    const body = { url: 'https://cdn.example.test/x.png?X-Amz-Signature=SECRETSIG' };

    const error = (() => {
      try {
        unwrapEnvelope(body, 'POST /upload');
        return null;
      } catch (e: unknown) {
        return e as RestApiError;
      }
    })();

    expect(error?.message).not.toContain('SECRETSIG');
    expect(error?.message).not.toContain('cdn.example.test');
  });

  it('passes an empty object through — an envelope with no fields is still an envelope', () => {
    // Shape validation of the payload itself belongs to the adapter that knows
    // which fields its route promises, not here.
    expect(unwrapEnvelope({ success: true, data: {} }, 'ctx')).toEqual({});
  });
});
