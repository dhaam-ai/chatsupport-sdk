import { afterEach, describe, expect, it, vi } from 'vitest';

import { consoleLogger, frameLogContext, silentLogger } from './logger.js';

describe('frameLogContext', () => {
  it('extracts the four allowlisted envelope fields', () => {
    const context = frameLogContext({
      v: 1,
      t: 'ack',
      id: '01J0000000000000000000000A',
      ref: '01J0000000000000000000000B',
      ts: 1_700_000_000_000,
      d: { ok: false, error: { code: 'VALIDATION_FAILED', message: 'bad', retryable: false } },
    });

    expect(context).toEqual({
      t: 'ack',
      id: '01J0000000000000000000000A',
      ref: '01J0000000000000000000000B',
    });
  });

  it('surfaces the error code, which is a closed enum', () => {
    const context = frameLogContext({
      t: 'error',
      id: '01J0000000000000000000000A',
      d: { code: 'PROTOCOL_VERSION_UNSUPPORTED', message: 'nope', retryable: false },
    });

    expect(context['errorCode']).toBe('PROTOCOL_VERSION_UNSUPPORTED');
  });

  // PRD §14. v1 logged token prefixes and lengths; neither is reproduced.
  it('never leaks credentials from a connection.hello payload', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.SUPER_SECRET_TOKEN_BODY.sig';
    const context = frameLogContext({
      v: 1,
      t: 'connection.hello',
      id: '01J0000000000000000000000A',
      ts: 1,
      d: { token, publishableKey: 'dhp_live_abc123', protocolVersion: 1 },
    });

    expect(context).toEqual({ t: 'connection.hello', id: '01J0000000000000000000000A' });

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('SUPER_SECRET');
    expect(serialized).not.toContain('dhp_live_abc123');
    // No prefix and no length oracle either.
    expect(serialized).not.toContain(token.slice(0, 8));
    expect(serialized).not.toContain(String(token.length));
  });

  it('never leaks message content or metadata', () => {
    const context = frameLogContext({
      t: 'message.send',
      id: '01J0000000000000000000000A',
      d: { content: 'my bank password is hunter2', type: 'TEXT', metadata: { ssn: '000-00-0000' } },
    });

    expect(context).toEqual({ t: 'message.send', id: '01J0000000000000000000000A' });
    expect(JSON.stringify(context)).not.toContain('hunter2');
  });

  it('handles values that are not frames at all', () => {
    expect(frameLogContext(null)).toEqual({});
    expect(frameLogContext(undefined)).toEqual({});
    expect(frameLogContext('a string')).toEqual({});
    expect(frameLogContext(42)).toEqual({});
    expect(frameLogContext([1, 2, 3])).toEqual({});
    expect(frameLogContext({})).toEqual({});
  });

  it('drops allowlisted fields that are present but the wrong type', () => {
    expect(frameLogContext({ t: 7, id: {}, ref: [], d: { code: 3 } })).toEqual({});
  });
});

describe('consoleLogger', () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it('forwards to console.warn with context', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spies.push(warn);

    consoleLogger.warn('dropped an inbound frame', { t: 'message.new' });

    expect(warn).toHaveBeenCalledWith('dropped an inbound frame', { t: 'message.new' });
  });

  it('omits the context argument entirely when there is none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spies.push(warn);

    consoleLogger.warn('bare message');

    expect(warn).toHaveBeenCalledWith('bare message');
  });

  it('degrades to a no-op when the runtime has no console', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'console');
    Reflect.deleteProperty(globalThis, 'console');

    try {
      expect(() => consoleLogger.warn('nowhere to go')).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'console', descriptor);
    }
  });
});

describe('silentLogger', () => {
  it('discards everything without throwing', () => {
    expect(() => silentLogger.warn('ignored', { t: 'error' })).not.toThrow();
  });
});
