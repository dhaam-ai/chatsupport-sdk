// @vitest-environment jsdom
//
// T11 built `createIdentityHeader`; this proves the widget actually MOUNTS it
// rather than keeping its own hand-built title `<h2>` beside it.
//
// The point of the mount is single-sourcing. The header already knows the two
// rules that are easy to get wrong (an absent `handledBy` means "use the
// configured title", and a PRESENT one can still be stale after a
// reactivation), so the widget's job here is wiring and nothing else — no
// second identity derivation on top, which is exactly the duplicate this
// design exists to prevent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
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

const titleText = (): string => query<HTMLElement>('#dh-title').textContent ?? '';

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function connected(session: SessionSnapshot = {}): Promise<{
  widget: ChatWidget;
  socket: FakeWebSocket;
}> {
  const widget = mount(config());
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/chat-token')) {
        return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
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
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('the header is T11’s component, not a second hand-built one', () => {
  it('mounts exactly one #dh-title, and the panel still labels itself with it', () => {
    mount(config());
    expect(shadow().querySelectorAll('#dh-title')).toHaveLength(1);
    expect(query('#dh-title').tagName).toBe('H2');
    expect(query('.dh-panel').getAttribute('aria-labelledby')).toBe('dh-title');
  });

  it('mounts the header’s own live region inside the panel', () => {
    mount(config());
    const regions = [...shadow().querySelectorAll('.dh-panel [role="status"][aria-atomic="true"]')];
    expect(regions.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the configured title before any session exists', () => {
    mount(config());
    expect(titleText()).toBe(TITLE);
  });
});

describe('identity follows the session', () => {
  it('names the agent once one is handling the chat', async () => {
    await connected({ status: 'ASSIGNED', handledBy: { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' } });
    expect(titleText()).toBe('Ada');
    expect(query('#dh-title').getAttribute('data-handled-by')).toBe('AGENT');
  });

  it('keeps the configured title when nobody has picked the chat up', async () => {
    await connected({ status: 'WAITING_FOR_AGENT' });
    expect(titleText()).toBe(TITLE);
  });

  it('updates when an agent joins mid-conversation', async () => {
    // `OPEN` rather than `WAITING_FOR_AGENT`: `applyAgentJoined` writes
    // `handledBy` but deliberately does NOT touch `status`, and
    // `isHandledByCurrent` refuses to narrate a handler while the session
    // still says it is waiting for one. That is core's rule and the header
    // defers to it — the subscription is what is under test here.
    const { socket } = await connected({ status: 'OPEN' });
    expect(titleText()).toBe(TITLE);

    socket.push('agent.joined', { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' });
    await settle();

    // `applyAgentJoined` spreads a NEW session object, so the default
    // strictEqual selector comparison sees the change — this is the assertion
    // that would fail if the subscription compared field-wise instead.
    expect(titleText()).toBe('Ada');
  });

  it('still refuses to name a joiner while the session says it is waiting', async () => {
    const { socket } = await connected({ status: 'WAITING_FOR_AGENT' });
    socket.push('agent.joined', { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' });
    await settle();

    // Not a bug in the wiring: core's `isHandledByCurrent` is the one gate,
    // and `agent.joined` does not advance `status`. Pinned so a future
    // "fix" here has to argue with core rather than quietly diverge from it.
    expect(titleText()).toBe(TITLE);
  });

  it('falls back again when the agent leaves', async () => {
    const { socket } = await connected({
      status: 'ASSIGNED',
      handledBy: { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' },
    });
    expect(titleText()).toBe('Ada');

    socket.push('agent.left', { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' });
    await settle();

    expect(titleText()).toBe(TITLE);
  });

  it('does not narrate a stale agent on a session that went back to waiting', async () => {
    const { socket } = await connected({
      status: 'ASSIGNED',
      handledBy: { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' },
    });
    expect(titleText()).toBe('Ada');

    // Exactly the reactivation shape: the server keeps the previous handler on
    // the record while the status goes back to WAITING_FOR_AGENT. Ada is not
    // on this chat right now, so her name must not be on the header.
    socket.sessionUpdated({
      status: 'WAITING_FOR_AGENT',
      handledBy: { kind: 'AGENT', id: 'agt_1', displayName: 'Ada' },
    });
    await settle();

    expect(titleText()).toBe(TITLE);
    expect(query('#dh-title').getAttribute('data-handled-by')).toBe('');
  });

  it('names a bot the same way it names a human', async () => {
    await connected({ status: 'OPEN', handledBy: { kind: 'BOT', id: 'bot_1', displayName: 'Assistant' } });
    expect(titleText()).toBe('Assistant');
    expect(query('#dh-title').getAttribute('data-handled-by')).toBe('BOT');
  });
});
