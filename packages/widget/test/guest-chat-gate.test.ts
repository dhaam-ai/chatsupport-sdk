// @vitest-environment jsdom
//
// Console "Allow visitor chat" (`behaviour.allowGuestChat`). Off: a guest (no
// `identity.profile`) gets a sign-in prompt and no socket; a signed-in visitor
// is unaffected. Harness trimmed from pre-chat-guest-only.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const PROFILE = { name: 'Jordan Rivera', email: 'jordan@example.com' };

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
}

let allowGuestChat: boolean | undefined;
let tokenMints = 0;

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'guest_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
    ...overrides,
  };
}

const shadow = (): ShadowRoot => document.querySelector<HTMLElement>('dh-chat-widget')!.shadowRoot!;
const signIn = (): HTMLElement | null => shadow().querySelector<HTMLElement>('.dh-signin');

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  FakeWebSocket.instances = [];
  allowGuestChat = undefined;
  tokenMints = 0;
  vi.stubGlobal('IntersectionObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/widget/config')) {
      return json({
        success: true,
        data: {
          enabled: true,
          appearance: {},
          behaviour: allowGuestChat === undefined ? {} : { allowGuestChat },
          flows: [],
          publishedVersion: 1,
        },
      });
    }
    if (url.includes('/api/chat-token')) {
      tokenMints += 1;
      return json({ accessToken: 'tok', expiresIn: 3600 });
    }
    if (url.includes('/ip-watermark')) return json({ ip: '203.0.113.7', watermark: 'wm' });
    if (url.includes('/identify')) return json({ success: true, data: { contactId: 'c1', externalId: 'cus_1' } });
    return json({ success: true, data: { sessions: [], messages: [], hasMore: false } });
  }));
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('allowGuestChat: false', () => {
  it('shows a guest the sign-in prompt and opens no socket', async () => {
    allowGuestChat = false;
    const widget = mount(config());
    await settle();
    widget.open();
    await settle();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(tokenMints).toBe(0);
    expect(signIn()?.hidden).toBe(false);
    expect(shadow().querySelector<HTMLElement>('.dh-composer')?.hidden).toBe(true);
  });

  it('wires the Sign in button to onSignInRequest', async () => {
    allowGuestChat = false;
    const onSignInRequest = vi.fn();
    const widget = mount(config({ onSignInRequest }));
    await settle();
    widget.open();
    await settle();

    signIn()!.querySelector<HTMLButtonElement>('button')!.click();
    expect(onSignInRequest).toHaveBeenCalledTimes(1);
  });

  it('leaves a signed-in visitor alone', async () => {
    allowGuestChat = false;
    mount(config({ identity: { userId: 'cus_1', profile: PROFILE } }));
    await settle();

    expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    expect(signIn()?.hidden).toBe(true);
  });
});

describe('portal staff are never guests', () => {
  // Merchant and manager joined admin as portal staff in the Messages redesign;
  // a merchant mounted without a customer `profile` must not be held as a
  // visitor, disconnected and shown "sign in" when visitor chat is off.
  it.each(['admin', 'merchant', 'manager'])('connects a %s with no profile', async (userRole) => {
    allowGuestChat = false;
    mount({ ...config(), userRole } as WidgetConfig);
    await settle();

    expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    const prompt = signIn();
    expect(prompt === null || prompt.hidden).toBe(true);
  });
});

describe('allowGuestChat absent or true', () => {
  it.each([undefined, true])('connects a guest (%s)', async (value) => {
    allowGuestChat = value;
    mount(config());
    await settle();

    expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    expect(signIn()?.hidden).toBe(true);
  });
});
