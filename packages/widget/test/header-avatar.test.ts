// @vitest-environment jsdom
//
// The header avatar's state machine (reported issue 9), end to end through a
// REAL mounted widget:
//
//   1. out of hours (`shouldCollectOffline`) — no avatar at all;
//   2. an agent on the chat — that agent's single-letter avatar;
//   3. otherwise — the merchant's configured brand face (logo or initials).
//
// The half that matters most here is agreement with the TITLE beside it:
// identity-header.ts gates the displayed name on core's `isHandledByCurrent`,
// and the avatar rides the same session subscription behind the same gate —
// so the assertions below repeatedly check the avatar AND the title together.
// A face of Ada next to "Acme Support" (or the reverse) is the bug this file
// exists to keep out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import { OFFLINE_MODE } from '../src/remote-config.js';
import type { ChatWidget } from '../src/widget.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const TITLE = 'Acme Support';

interface SessionSnapshot {
  readonly status?: string;
  readonly handledBy?: { kind: 'AGENT' | 'BOT'; id: string; displayName: string };
}

let frameCounter = 0;
const frameId = (): string => `01ARZ3NDEKTSV4RRFFQ69G5F${String(frameCounter++ % 10)}0`;

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

  push(t: string, d: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, t, id: frameId(), ts: Date.now(), d }) });
  }

  ack(session: SessionSnapshot = {}, sessionId = 'sess_1'): void {
    this.push('connection.ack', {
      protocolVersion: 1,
      seq: 0,
      session: {
        sessionId,
        status: session.status ?? 'ASSIGNED',
        mode: 'HUMAN',
        participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
        createdAt: new Date().toISOString(),
        ...(session.handledBy === undefined ? {} : { handledBy: session.handledBy }),
      },
    });
  }

  sessionUpdated(session: SessionSnapshot, sessionId = 'sess_1'): void {
    this.push('session.updated', {
      session: {
        sessionId,
        status: session.status ?? 'ASSIGNED',
        mode: 'HUMAN',
        participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
        createdAt: new Date().toISOString(),
        ...(session.handledBy === undefined ? {} : { handledBy: session.handledBy }),
      },
    });
  }
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    title: TITLE,
    // The merchant's configured brand face, so the fallback branch has
    // something visible to fall back TO in most of the tests below.
    avatarInitials: 'AC',
    onError: () => undefined,
    ...overrides,
  };
}

/** The published-config body — same shape remote-config-gating.test.ts serves. */
function published(data: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    data: {
      enabled: true,
      appearance: {},
      behaviour: {},
      offlineMode: OFFLINE_MODE.SHOW_MESSAGE,
      isOpenNow: null,
      flows: [],
      publishedVersion: 1,
      ...data,
    },
  };
}

/** Serves the token mint, the config endpoint, and empty history. */
function stubFetch(configBody: unknown = published()): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/chat-token')) {
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/widget/config')) {
        return new Response(JSON.stringify(configBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: { messages: [], hasMore: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
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

const host = (): HTMLElement => query<HTMLElement>('.dh-header .dh-avatar-host');
const avatarText = (): string | null =>
  shadow().querySelector('.dh-header .dh-avatar')?.textContent ?? null;
const isAgentAvatar = (): boolean =>
  shadow().querySelector('.dh-header .dh-avatar-agent') !== null;
const titleText = (): string => query<HTMLElement>('#dh-title').textContent ?? '';

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function connected(
  session: SessionSnapshot = {},
  cfg: WidgetConfig = config(),
): Promise<{ widget: ChatWidget; socket: FakeWebSocket }> {
  const widget = mount(cfg);
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack(session);
  await settle();
  return { widget, socket };
}

beforeEach(() => {
  localStorage.clear();
  frameCounter = 0;
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('no agent — the brand face', () => {
  it('shows the configured initials while nobody has picked the chat up', async () => {
    await connected({ status: 'WAITING_FOR_AGENT' });
    expect(host().hidden).toBe(false);
    expect(avatarText()).toBe('AC');
    expect(isAgentAvatar()).toBe(false);
  });

  it('shows the uploaded logo when the merchant chose one', async () => {
    await connected(
      { status: 'WAITING_FOR_AGENT' },
      config({ avatarMode: 'logo', logoUrl: 'https://cdn.example.com/logo.png' }),
    );
    const img = query<HTMLImageElement>('.dh-header .dh-avatar-image');
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/logo.png');
  });

  it('still draws nothing when the merchant configured no brand face at all', async () => {
    // The pre-existing contract buildHeaderAvatar documents: no grey
    // placeholder disc where a brand was supposed to be. Omitted by
    // destructuring rather than set to `undefined` — WidgetConfig is compiled
    // under `exactOptionalPropertyTypes`, where those are different shapes.
    const { avatarInitials: _brand, ...noBrand } = config();
    await connected({ status: 'WAITING_FOR_AGENT' }, noBrand);
    expect(host().hidden).toBe(true);
    expect(host().childElementCount).toBe(0);
  });
});

describe('an agent on the chat — their letter', () => {
  it('shows the agent’s first initial, agreeing with the title beside it', async () => {
    await connected({
      status: 'ASSIGNED',
      handledBy: { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' },
    });
    expect(avatarText()).toBe('A');
    expect(isAgentAvatar()).toBe(true);
    expect(titleText()).toBe('Ada');
  });

  it('flips from brand to agent when one joins mid-conversation', async () => {
    // `OPEN`, not `WAITING_FOR_AGENT` — same reasoning as the identity-header
    // mount test: `agent.joined` writes `handledBy` without touching
    // `status`, and `isHandledByCurrent` refuses a handler while the session
    // says it is still waiting for one.
    const { socket } = await connected({ status: 'OPEN' });
    expect(avatarText()).toBe('AC');

    socket.push('agent.joined', { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' });
    await settle();

    expect(avatarText()).toBe('A');
    expect(isAgentAvatar()).toBe(true);
  });

  it('falls back to the brand face when the agent leaves', async () => {
    const { socket } = await connected({
      status: 'ASSIGNED',
      handledBy: { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' },
    });
    expect(isAgentAvatar()).toBe(true);

    socket.push('agent.left', { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' });
    await settle();

    expect(avatarText()).toBe('AC');
    expect(isAgentAvatar()).toBe(false);
  });

  it('refuses a stale handler exactly as the title does', async () => {
    const { socket } = await connected({
      status: 'ASSIGNED',
      handledBy: { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' },
    });

    // The reactivation shape: the server keeps the previous handler on the
    // record while the status goes back to WAITING_FOR_AGENT. The title
    // drops Ada's name; a face of her lingering beside "Acme Support" would
    // be the avatar and the title disagreeing about whether she is present.
    socket.sessionUpdated({
      status: 'WAITING_FOR_AGENT',
      handledBy: { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' },
    });
    await settle();

    expect(titleText()).toBe(TITLE);
    expect(avatarText()).toBe('AC');
    expect(isAgentAvatar()).toBe(false);
  });

  it('letters a bot the same way, because the title names one the same way', async () => {
    await connected({
      status: 'OPEN',
      handledBy: { kind: 'BOT', id: 'bot_1', displayName: 'Assistant' },
    });
    expect(avatarText()).toBe('A');
    expect(isAgentAvatar()).toBe(true);
    expect(titleText()).toBe('Assistant');
  });
});

describe('the hero design mounts the avatar too', () => {
  it('no longer suppresses the header avatar under design: "hero"', async () => {
    // Reported issue 9: the old code skipped the avatar for the hero design
    // on the theory that its face row covers it — but that row renders only
    // on Home, so every hero-design conversation had no avatar at all.
    await connected({ status: 'WAITING_FOR_AGENT' }, config({ design: 'hero' }));
    expect(host().hidden).toBe(false);
    expect(avatarText()).toBe('AC');
  });
});

describe('out of hours — no avatar at all', () => {
  it('hides the avatar while the leave-a-message surface is active', async () => {
    stubFetch(published({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: false }));
    mount(config());
    await settle();

    // The surface itself is up (remote-config-gating.test.ts pins that); the
    // avatar follows the SAME predicate, so no brand face floats above a
    // "we're closed" form implying someone is there to answer.
    expect(shadow().querySelector('.dh-offline-form')).not.toBeNull();
    expect(host().hidden).toBe(true);
    expect(host().childElementCount).toBe(0);
  });

  it('keeps the brand face when the team is open', async () => {
    stubFetch(published({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: true }));
    mount(config());
    await settle();

    expect(shadow().querySelector('.dh-offline-form')).toBeNull();
    expect(host().hidden).toBe(false);
    expect(avatarText()).toBe('AC');
  });
});
