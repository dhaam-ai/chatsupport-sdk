// @vitest-environment jsdom
//
// T18 — SDK acceptance tests for CONTACT_IDENTIFY_SPEC.md §10's AC13 and
// AC14, exercised through the widget's real mount()/unmount() lifecycle.
//
// identity-profile.test.ts already owns the CONFIG-SEAM layer exhaustively
// (WidgetIdentity.profile -> core's two flat fields, the wrapper that bridges
// Promise<RestIdentityResult> to Promise<void> without swallowing a
// rejection). This file is the one level up: does the WHOLE assembled stack
// — real (fake-driven) WebSocket handshake, real (mocked) fetch, real jsdom
// localStorage backing the dedup TTL across two separate mount() calls —
// actually behave the way AC13/AC14 promise, for a host that just calls
// `mount()` and never looks at `identityProfile`/`identitySync` at all.
//
// Timer setup mirrors connecting-state.test.ts: `shouldAdvanceTime: true`
// keeps the real-timer-driven `settle()` loops working (fetch promise
// chains resolve on real microtasks/macrotasks) while still letting a test
// fast-forward past identify's own jittered retry delay deterministically
// with `vi.advanceTimersByTimeAsync`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { ChatWidget } from '../src/widget.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const IDENTIFY_PATH = '/chat-services/api/v1/identify';

const PROFILE = { name: 'Jordan Rivera', email: 'jordan@example.com' };

/** A hand-driven stand-in for the browser `WebSocket` global — the same
 *  shape connecting-state.test.ts and history-on-connect.test.ts use. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
  open(): void {
    this.onopen?.();
  }
  ack(sessionId = 'sess_1'): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
        ts: Date.now(),
        d: {
          protocolVersion: 1,
          seq: 0,
          session: {
            sessionId,
            status: 'ASSIGNED',
            mode: 'HUMAN',
            participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
            createdAt: new Date().toISOString(),
          },
        },
      }),
    });
  }
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

type IdentifyOutcome = 'success' | 'network-error' | 'server-error';

function shadowText(): string {
  const host = document.querySelector('dh-chat-widget');
  return host?.shadowRoot?.textContent ?? '';
}

async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The newest socket, which is the one core is currently attempting on. */
function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (socket === undefined) throw new Error('no socket was opened');
  return socket;
}

let identifyCalls: Array<Record<string, unknown>>;
let identifyOutcome: IdentifyOutcome;

beforeEach(() => {
  localStorage.clear();
  FakeWebSocket.instances = [];
  identifyCalls = [];
  identifyOutcome = 'success';
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/chat-token')) {
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes(IDENTIFY_PATH)) {
        identifyCalls.push(
          init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
        );
        if (identifyOutcome === 'network-error') {
          throw new TypeError('Failed to fetch');
        }
        if (identifyOutcome === 'server-error') {
          return new Response(
            JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: { contactId: 'c1', externalId: 'cus_1', lastLoginAt: new Date().toISOString() },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // History, session-summary, or anything else the widget touches on
      // connect — an innocuous empty success is enough for these tests.
      return new Response(JSON.stringify({ success: true, data: { messages: [], hasMore: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  document.body.innerHTML = '';
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AC13 — identify fires once per mount, dedupes within the TTL, and reacts to a profile change', () => {
  it('one POST on first mount, zero more on an identical remount inside the TTL, one more the instant a field changes', async () => {
    const widgetA = mount(config({ identity: { userId: 'cus_1', profile: PROFILE } }));
    await settle();
    expect(identifyCalls).toEqual([PROFILE]);
    widgetA.destroy();

    // Same browser storage — never cleared between these three mounts, same
    // as a real page never clearing its own localStorage between route
    // changes — same user, same profile, well inside the 15-minute TTL. This
    // is the "SPA remounts the widget on every route change" case spec §7.3
    // exists to make cheap.
    const widgetB = mount(config({ identity: { userId: 'cus_1', profile: PROFILE } }));
    await settle();
    expect(identifyCalls).toHaveLength(1);
    widgetB.destroy();

    // A real profile change bypasses the TTL immediately (§7.3) — no waiting
    // required.
    const changed = { ...PROFILE, city: 'Pune' };
    const widgetC = mount(config({ identity: { userId: 'cus_1', profile: changed } }));
    await settle();
    expect(identifyCalls).toHaveLength(2);
    expect(identifyCalls[1]).toEqual(changed);
    widgetC.destroy();
  });

  it('a guest (no profile at all) never calls POST /identify', async () => {
    const widget = mount(config({ identity: { userId: 'guest_1' } }));
    await settle();

    expect(identifyCalls).toHaveLength(0);
    widget.destroy();
  });
});

describe('AC14 — an identify failure is invisible to the widget', () => {
  it.each<{ label: string; outcome: IdentifyOutcome }>([
    { label: 'a network failure', outcome: 'network-error' },
    { label: 'a 500 from the server', outcome: 'server-error' },
  ])(
    '$label on every attempt does not throw out of mount(), does not block connecting, and never reaches the UI',
    async ({ outcome }) => {
      identifyOutcome = outcome;
      const unhandled: unknown[] = [];
      const record = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', record);

      const onError = vi.fn();
      let widget: ChatWidget | undefined;

      try {
        widget = mount(config({ identity: { userId: 'cus_1', profile: PROFILE }, onError }));

        // mount() itself did not throw — reaching this line already proves
        // half the criterion; the try/finally below covers the rest.
        await settle();

        // One attempt has already failed. Advance past the jittered retry
        // delay (base 500ms, IDENTIFY_RETRY_LIMIT = 1) so the second — and
        // final — attempt also runs and also fails.
        await vi.advanceTimersByTimeAsync(600);
        await settle();

        expect(identifyCalls.length).toBe(2);

        // Reported through the host's own error sink — never thrown into
        // application code, never silently dropped either.
        expect(onError).toHaveBeenCalled();

        // The connection itself never noticed. Drive the handshake exactly
        // like every other test in this suite.
        latestSocket().open();
        latestSocket().ack();
        await settle();

        expect(widget.store.getState().connectionState).toBe('connected');
        expect(widget.store.getState().lastError).toBeNull();

        // And nothing about the failed identify attempt is readable anywhere
        // in the widget's own DOM — no email, no profile field, no
        // "identify"-shaped text of any kind.
        const text = shadowText();
        expect(text.toLowerCase()).not.toContain('identify');
        expect(text).not.toContain(PROFILE.email);
        expect(text).not.toContain(PROFILE.name);

        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', record);
        widget?.destroy();
      }
    },
  );
});
