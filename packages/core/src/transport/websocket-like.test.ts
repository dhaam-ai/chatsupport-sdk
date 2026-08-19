import { afterEach, describe, expect, it } from 'vitest';

import { defaultWebSocketFactory, WS_READY_STATE } from './websocket-like.js';

describe('WS_READY_STATE', () => {
  it('matches the WHATWG WebSocket readyState constants', () => {
    expect(WS_READY_STATE).toEqual({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  });
});

describe('defaultWebSocketFactory', () => {
  const originalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it('throws a clear error when no global WebSocket constructor exists', () => {
    // @ts-expect-error — deliberately removing the global for this test.
    delete globalThis.WebSocket;

    expect(() => defaultWebSocketFactory('ws://example.invalid')).toThrow(/no global WebSocket/);
  });

  it('constructs a global WebSocket when one is available', () => {
    let constructedWith: string | undefined;
    class FakeGlobalWebSocket {
      constructor(url: string) {
        constructedWith = url;
      }
    }
    // @ts-expect-error — a minimal stand-in is enough to prove the factory calls `new WebSocket(url)`.
    globalThis.WebSocket = FakeGlobalWebSocket;

    defaultWebSocketFactory('ws://example.invalid/socket');

    expect(constructedWith).toBe('ws://example.invalid/socket');
  });
});
