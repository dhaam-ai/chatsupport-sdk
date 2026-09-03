// @vitest-environment jsdom
//
// Defect 1: the pre-chat questions are for GUESTS, and only for guests.
//
// ── What "guest" means here ───────────────────────────────────────────────
//
// "No host-asserted identity", NOT "no userId". Every visitor carries a
// `userId` — a guest's is an anonymous handle the host page minted — so its
// presence discriminates nothing. The one signal is `identity.profile`:
// supplying it is the host stating, under its own publishable key, who this
// person is. `client.ts` already keys `identityProfile`/`identitySync` off
// exactly that, which is why `POST /identify` fires for logged-in visitors
// only; `widget.ts` now reads the same fact once, as `isGuest`, and gates both
// asks on it.
//
// ── The two asks, which used to disagree ──────────────────────────────────
//
// The same `preChatFields` are collected in two places: the standalone gate in
// front of an already-open, still-empty conversation, and the fields folded
// into the new-conversation form. Neither had a guest check at all, so a
// signed-in customer was asked to retype the name and email their contact
// record already holds — free text arriving at that record from a lower-trust
// channel than the one that filled it.
//
// ── And what a logged-in visitor still sends ──────────────────────────────
//
// Suppressing the questions must not suppress the DATA. Two paths carry a
// logged-in visitor's details without asking them anything, and both are
// asserted below: `POST /identify` (create-or-update on the contact) and
// `contact-info.ts`'s enrichment (`GET /ip-watermark`, the raw user agent and
// best-effort geolocation, which run for every visitor, guest included).
//
// Same hand-run fake socket pre-chat-preemption.test.ts uses, for the same
// reason: the gate's precondition is a real `connection.hello` ->
// `connection.ack` with a genuinely empty transcript.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import { OFFLINE_MODE } from '../src/remote-config.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const PROFILE = { name: 'Jordan Rivera', email: 'jordan@example.com' };

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let ulidCounter = 0;
function ulid(): string {
  const c = ULID_ALPHABET[ulidCounter++ % 32] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${c}${c}`;
}

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
  sentFrames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
  open(): void {
    this.onopen?.();
  }
  ack(sessionId = 'sess_1', status = 'ASSIGNED'): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: ulid(),
        ts: Date.now(),
        d: {
          protocolVersion: 1,
          seq: 0,
          session: {
            sessionId,
            status,
            mode: 'HUMAN',
            participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
            createdAt: new Date().toISOString(),
          },
        },
      }),
    });
  }
}

const FIELDS: unknown[] = [
  { id: 'name', label: 'Your name', type: 'text', required: true },
  { id: 'email', label: 'Email address', type: 'email', required: true },
];

/**
 * Whether the merchant is out of hours, and what they do about it — a `let`
 * the config stub reads at CALL time, so a test can put the widget outside
 * business hours before mounting it.
 */
let offlineMode: number = OFFLINE_MODE.SHOW_MESSAGE;
let isOpenNow: boolean | null = null;

function publishedConfig(): unknown {
  return {
    success: true,
    data: {
      enabled: true,
      appearance: {},
      behaviour: {
        preChatEnabled: true,
        preChatFields: FIELDS,
        conversationTopics: [{ id: 'delivery', label: 'Delivery issue' }],
      },
      offlineMode,
      isOpenNow,
      flows: [],
      publishedVersion: 1,
    },
  };
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

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element === null) throw new Error('widget host not found');
  const root = element.shadowRoot;
  if (root === null) throw new Error('shadow root not found');
  return root;
}

const query = <T extends Element>(selector: string): T => {
  const found = shadow().querySelector<T>(selector);
  if (found === null) throw new Error(`not found: ${selector}`);
  return found;
};
const find = <T extends Element>(selector: string): T | null => shadow().querySelector<T>(selector);

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

let requests: Array<{ method: string; url: string }>;
let widget: ReturnType<typeof mount>;

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
  requests = [];
  offlineMode = OFFLINE_MODE.SHOW_MESSAGE;
  isOpenNow = null;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('WebSocket', FakeWebSocket);
  // A granted fix. Location is one of the three things defect 1 says a
  // logged-in visitor's record must carry, and jsdom ships no Geolocation API
  // at all, so without this the widget would correctly send nothing and the
  // assertion below would be testing the absence rather than the capture.
  vi.stubGlobal('navigator', navigator);
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (position: { coords: { latitude: number; longitude: number } }) => void) => {
        ok({ coords: { latitude: 12.97, longitude: 77.59 } });
      },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ method: init?.method ?? 'GET', url });
      const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/widget/config')) return json(publishedConfig());
      if (url.includes('/api/chat-token')) return json({ accessToken: 'tok', expiresIn: 3600 });
      // Bare `{ip, watermark}`, NOT an envelope — this route predates the
      // `{success, data}` wrapper the chat routes use, and `fetchIpWatermark`
      // reads the two fields off the top level.
      if (url.includes('/ip-watermark')) {
        return json({ ip: '203.0.113.7', watermark: 'wm-abc' });
      }
      if (url.includes('/identify')) {
        return json({
          success: true,
          data: { contactId: 'con_1', externalId: 'cus_1', lastLoginAt: '2026-08-19T09:00:00.000Z' },
        });
      }
      if (url.includes('/chat/sessions/customer')) return json({ success: true, data: { sessions: [] } });
      return json({ success: true, data: { messages: [], hasMore: false } });
    }),
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

/**
 * Connects with the panel opened straight onto a live, EMPTY conversation —
 * the only state in which the standalone gate is armed (see
 * `conversationOpened`'s own doc in widget.ts).
 */
async function connectedOnConversation(overrides: Partial<WidgetConfig> = {}): Promise<void> {
  widget = mount(config({ sessionId: 'sess_1', ...overrides }));
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack('sess_1', 'ASSIGNED');
  await settle();
  widget.open();
  await settle();
}

/** The pre-chat inputs inside the new-conversation form (the message box is a textarea). */
const newConvoFields = () => [
  ...shadow().querySelectorAll<HTMLInputElement>('.dh-newconvo-form input.dh-field-input'),
];

/** Opens the new-conversation flow through the ⋯ menu — one of its five entry points. */
function openStartNew(): void {
  query<HTMLButtonElement>('.dh-hmenu-toggle').click();
  const item = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-hmenu-item')].find((button) =>
    button.textContent?.includes('Start new conversation'),
  );
  if (item === undefined) throw new Error('no "Start new conversation" item');
  item.click();
}

describe('the standalone pre-chat gate', () => {
  it('greets a GUEST with the merchant’s questions', async () => {
    await connectedOnConversation();
    expect(find('.dh-prechat-form')).not.toBeNull();
  });

  it('never shows them to a LOGGED-IN visitor — the conversation is what they get', async () => {
    await connectedOnConversation({ identity: { userId: 'cus_1', profile: PROFILE } });

    expect(find('.dh-prechat-form')).toBeNull();
    // Not merely "the form is absent": the transcript and composer are on
    // screen, which is what "no gate" has to mean for the customer.
    expect(query<HTMLElement>('.dh-log').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
  });
});

describe('the same questions folded into the new-conversation form', () => {
  it('collects them from a GUEST', async () => {
    await connectedOnConversation();
    openStartNew();
    await settle();

    expect(find('.dh-newconvo-form')).not.toBeNull();
    expect(newConvoFields().map((input) => input.id)).toEqual([
      'dh-newconvo-field-name',
      'dh-newconvo-field-email',
    ]);
  });

  it('omits them for a LOGGED-IN visitor, leaving the form itself intact', async () => {
    await connectedOnConversation({ identity: { userId: 'cus_1', profile: PROFILE } });
    openStartNew();
    await settle();

    // The form is still there — this is the ONE place a topic and an opening
    // message are chosen, and suppressing it would take the flow away rather
    // than the questions.
    expect(find('.dh-newconvo-form')).not.toBeNull();
    expect(newConvoFields()).toHaveLength(0);
    expect(find('.dh-newconvo-message')).not.toBeNull();
  });
});

describe('the same questions on the out-of-hours offline form', () => {
  // The third surface, and the one that used to be missed. It is the FIRST
  // branch of `syncProductSurfaces`, ahead of both gates above, so a
  // logged-in visitor arriving outside business hours met the merchant's
  // questions on the one path where neither other check could run.
  //
  // The form's own two built-in fields (Name, "Email or phone") are NOT
  // gated — see `isGuest`'s doc: they are the reply channel for a message
  // answered hours later, out of band from any session, not the merchant's
  // pre-chat questions.
  const offlineFields = () => [
    ...shadow().querySelectorAll<HTMLInputElement>('.dh-offline-form input.dh-field-input'),
  ].map((input) => input.id);

  it('asks a GUEST the merchant’s fields alongside the built-in two', async () => {
    offlineMode = OFFLINE_MODE.COLLECT_MESSAGE;
    isOpenNow = false;
    await connectedOnConversation();

    expect(find('.dh-offline-form')).not.toBeNull();
    // The console seeds "Your name"/"Email address", which the form drops as
    // duplicates of its own two — so what proves the merchant's fields are
    // being rendered at all is that the built-ins are there and nothing else
    // has been added beside them.
    expect(offlineFields()).toEqual(['dh-offline-name', 'dh-offline-contact']);
  });

  it('never shows them to a LOGGED-IN visitor, but still offers a reply channel', async () => {
    offlineMode = OFFLINE_MODE.COLLECT_MESSAGE;
    isOpenNow = false;
    await connectedOnConversation({ identity: { userId: 'cus_1', profile: PROFILE } });

    const form = find('.dh-offline-form');
    expect(form).not.toBeNull();
    // Exactly the built-in pair, and no merchant question among them.
    expect(offlineFields()).toEqual(['dh-offline-name', 'dh-offline-contact']);
    expect(form?.textContent).not.toContain('Order number');
  });

  it('drops a merchant field the built-ins do NOT already cover, for a logged-in visitor', async () => {
    // The assertion the seeded-label pair above cannot make: a field with no
    // built-in equivalent survives the duplicate filter, so its presence or
    // absence is entirely down to `isGuest`.
    FIELDS.push({ id: 'order', label: 'Order number', type: 'text', required: false });
    try {
      offlineMode = OFFLINE_MODE.COLLECT_MESSAGE;
      isOpenNow = false;

      await connectedOnConversation();
      expect(offlineFields()).toContain('dh-offline-order');

      unmount();
      FakeWebSocket.instances = [];
      await connectedOnConversation({ identity: { userId: 'cus_1', profile: PROFILE } });
      expect(offlineFields()).not.toContain('dh-offline-order');
    } finally {
      FIELDS.pop();
    }
  });
});

describe('a logged-in visitor’s details reach the contact record anyway', () => {
  it('still upserts them through POST /identify', async () => {
    await connectedOnConversation({ identity: { userId: 'cus_1', profile: PROFILE } });

    const identify = requests.find((r) => r.method === 'POST' && r.url.includes('/identify'));
    expect(identify).toBeDefined();
  });

  it('does NOT call identify for a guest — there is no asserted identity to upsert', async () => {
    await connectedOnConversation();
    expect(requests.some((r) => r.url.includes('/identify'))).toBe(false);
  });

  it('still captures IP / user agent / location, exactly as it does for a guest', async () => {
    await connectedOnConversation({ identity: { userId: 'cus_1', profile: PROFILE } });

    // The watermarked IP is fetched for a logged-in visitor too — the capture
    // path is not gated on being a guest, and this is the half of defect 1
    // that is NOT about asking questions.
    expect(requests.some((r) => r.url.includes('/ip-watermark'))).toBe(true);

    // …and it reaches the server on a `connection.hello`, as top-level
    // `ip`/`ipWatermark`/`userAgent`/`geo` fields (ConnectionHelloPayload) —
    // NOT a nested `device` object.
    //
    // On the NEXT hello, not necessarily the first: `captureContactInfo` is
    // fire-and-forget precisely so a slow ip-watermark fetch (or a GPS prompt
    // the visitor never answers) cannot delay `connect()`, so whichever of
    // the two round trips wins is a race by design. contact-info.ts's header
    // states the consequence — a value that resolves late "rides along on the
    // next one (typically a reconnect)" — so the assertion is made where the
    // contract actually promises it rather than on a coin flip.
    widget.store.client.disconnect();
    await settle();
    void widget.store.client.connect();
    await settle();

    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (socket === undefined) throw new Error('no reconnect socket');
    // The hello goes out on `onopen`, not on construction.
    socket.open();
    await settle();

    const hello = socket.sentFrames().find((frame) => frame['t'] === 'connection.hello');
    const d = hello?.['d'] as Record<string, unknown> | undefined;
    expect(d?.['ip']).toBe('203.0.113.7');
    expect(d?.['ipWatermark']).toBe('wm-abc');
    expect(typeof d?.['userAgent']).toBe('string');
    expect(d?.['geo']).toEqual({ lat: 12.97, lng: 77.59 });
  });
});
