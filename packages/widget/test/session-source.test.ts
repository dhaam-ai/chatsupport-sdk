// @vitest-environment jsdom
//
// `client.listSessions()` is the session picker's only data source, and core
// refuses to run it at all unless `ChatClientConfig.sessionSummarySource` was
// supplied — it throws `ChatClientConfigError` rather than guessing at a
// transport. That seam is exactly what client.ts exists to fill in on the
// integrator's behalf, alongside `history`, `uploader` and `sessionActions`.
//
// These tests are about the WIRING, not about the picker: that the widget's
// own client can list sessions at all, that it hits the route the
// chat-service actually serves, and that an empty page — which is what a
// guest gets, per the route's own contract — arrives as an ordinary
// successful `[]` rather than as a failure.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWidgetStore } from '../src/client.js';
import { resolveConfig } from '../src/config.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

class SilentSocket {
  readonly readyState = 0;
  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
    ...overrides,
  };
}

const ROW = {
  id: 'sess_9',
  status: 'RESOLVED',
  mode: 'HUMAN',
  createdAt: '2026-08-19T09:00:00.000Z',
  closedAt: '2026-08-19T10:00:00.000Z',
  lastMessageAt: '2026-08-19T09:30:00.000Z',
  lastMessagePreview: 'Thanks!',
  unreadCount: 0,
  handledBy: { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' },
};

let requested: string[] = [];

function stubFetch(sessions: unknown[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes('/api/chat-token')) {
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: { sessions } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  requested = [];
  vi.stubGlobal('WebSocket', SilentSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the widget wires listSessions for the integrator', () => {
  it('does not throw ChatClientConfigError — the seam is supplied', async () => {
    stubFetch([ROW]);
    const { store } = createWidgetStore(resolveConfig(config()));

    await expect(store.client.listSessions({ limit: 5 })).resolves.toBeInstanceOf(Array);

    store.destroy({ disconnect: true });
  });

  it('calls the customer-sessions route with the picker’s page size', async () => {
    stubFetch([ROW]);
    const { store } = createWidgetStore(resolveConfig(config()));

    await store.client.listSessions({ limit: 5 });

    const call = requested.find((url) => url.includes('/chat/sessions/customer'));
    expect(call).toBeDefined();
    expect(call).toContain('limit=5');

    store.destroy({ disconnect: true });
  });

  it('projects the row into core’s ChatSessionSummary, handledBy included', async () => {
    stubFetch([ROW]);
    const { store } = createWidgetStore(resolveConfig(config()));

    const sessions = await store.client.listSessions({ limit: 5 });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe('sess_9');
    expect(sessions[0]?.status).toBe('RESOLVED');
    expect(sessions[0]?.handledBy?.displayName).toBe('Ada');

    store.destroy({ disconnect: true });
  });

  it('writes the page to ChatState.pastSessions, so the picker needs no second read', async () => {
    stubFetch([ROW]);
    const { store } = createWidgetStore(resolveConfig(config()));

    await store.client.listSessions({ limit: 5 });

    expect(store.getState().pastSessions.map((summary) => summary.id)).toEqual(['sess_9']);

    store.destroy({ disconnect: true });
  });

  it('resolves an empty page normally — that IS the guest signal', async () => {
    stubFetch([]);
    const { store } = createWidgetStore(resolveConfig(config()));

    await expect(store.client.listSessions({ limit: 5 })).resolves.toEqual([]);
    expect(store.getState().pastSessions).toEqual([]);

    store.destroy({ disconnect: true });
  });
});
