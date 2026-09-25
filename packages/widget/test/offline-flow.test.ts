// @vitest-environment jsdom
//
// The out-of-hours BOT FLOW, end to end: a real mounted widget, a stubbed
// `/widget/config` carrying an OFFLINE flow, and assertions on what the visitor
// sees and what goes out on the socket. The fixtures (sockets, config stub,
// find/settle) are the ones remote-config-gating.test.ts uses, kept identical
// on purpose so the two files describe the same world.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import { OFFLINE_MODE } from '../src/remote-config.js';
import type { WidgetConfig } from '../src/config.js';

const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

class SilentSocket {
  static readonly CONNECTING = 0;
  readonly readyState = 0;
  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

/**
 * A socket that finishes the handshake and answers with one live, EMPTY
 * session — which is what chat-service's own `handleHello` does for EVERY
 * visitor, first-timers included: it mints or resumes a row and acks with it.
 *
 * `SilentSocket` above is right for everything in this file that only cares
 * what published config paints — but the pre-chat gate stands in front of a
 * conversation the customer has OPENED (see `syncProductSurfaces`), and
 * proving either half of that takes a real ack. Only the frames that
 * precondition needs are modelled here; pre-chat-preemption.test.ts owns the
 * full-fidelity fake for everything past it.
 */
class AckingSocket {
  static instances: AckingSocket[] = [];
  static readonly CONNECTING = 0;
  readonly readyState = 1;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(readonly url: string) {
    AckingSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }

  /** Opens, then answers the hello with a live session carrying no messages. */
  ack(sessionId: string): void {
    this.onopen?.();
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
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
    auth: { publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    // connect() rejects by design in this environment; a wall of expected
    // failures would hide a real one.
    onError: () => undefined,
    ...overrides,
  };
}

/** The published-config body, with only what a test cares about overridden. */
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

/**
 * Serves the token mint and the config endpoint, and nothing else.
 *
 * Routed on the path rather than call order: the widget fires both during
 * mount and the order between them is not part of any contract this file
 * should be pinning.
 */
function stubFetch(configBody: unknown, { failConfig = false } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/widget/config')) {
        if (failConfig) {
          // Exactly what a blocked cross-origin read looks like from JS: a
          // bare TypeError with no detail. See WIDGET_ALLOWED_ORIGINS.
          throw new TypeError('Failed to fetch');
        }
        return new Response(JSON.stringify(configBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/chat/sessions/customer')) {
        return new Response(JSON.stringify({ success: true, data: { sessions: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/chat/sessions/')) {
        // Every history page: empty, which is the gate's own precondition.
        return new Response(JSON.stringify({ success: true, data: { messages: [], hasMore: false } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element?.shadowRoot == null) throw new Error('widget not mounted');
  return element.shadowRoot;
}

const find = <T extends Element>(selector: string): T | null => shadow().querySelector<T>(selector);

/** Lets the config fetch and its promise chain land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  AckingSocket.instances = [];
  vi.stubGlobal('WebSocket', SilentSocket);
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

const FLOW = {
  id: 'flow-1',
  name: 'Out of hours',
  trigger: 4,
  keywords: [],
  pagePattern: '',
  steps: [
    { id: 'a', kind: 'message', text: 'We are closed right now.' },
    { id: 'b', kind: 'question', text: 'What is your email?', saveAs: 'email' },
    { id: 'c', kind: 'end', text: 'Thanks, we will reply soon.' },
  ],
};

const closedWith = (flows: unknown[]) =>
  published({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: false, flows });

const botLines = () =>
  [...shadow().querySelectorAll<HTMLElement>('.dh-flow-line[data-from="bot"]')].map((n) => n.textContent);

function frames(socket: InstanceType<typeof AckingSocket>): Array<{ t: string; d: Record<string, unknown> }> {
  return socket.sent.map((s) => JSON.parse(s));
}

async function mountClosed(configBody: unknown) {
  stubFetch(configBody);
  vi.stubGlobal('WebSocket', AckingSocket);
  const widget = mount(config());
  await settle();
  AckingSocket.instances[0]!.ack('sess_live');
  await settle();
  widget.open();
  await settle();
  return widget;
}

async function answerEmail(value: string) {
  find<HTMLInputElement>('.dh-flow-form input')!.value = value;
  find<HTMLFormElement>('.dh-flow-form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await settle();
}

describe('COLLECT_MESSAGE runs the published OFFLINE flow', () => {
  it('shows the flow instead of the built-in form', async () => {
    await mountClosed(closedWith([FLOW]));
    expect(find('.dh-flow')).not.toBeNull();
    expect(find('.dh-offline-form')).toBeNull();
    expect(botLines()).toEqual(['We are closed right now.', 'What is your email?']);
  });

  it('falls back to the built-in form when no OFFLINE flow is published', async () => {
    await mountClosed(closedWith([]));
    expect(find('.dh-offline-form')).not.toBeNull();
    expect(find('.dh-flow')).toBeNull();
  });

  it('falls back to the built-in form when the flow has no usable steps', async () => {
    await mountClosed(closedWith([{ ...FLOW, steps: [{ id: 'x', kind: 'webhook' }] }]));
    expect(find('.dh-offline-form')).not.toBeNull();
  });

  it('ignores flows for other triggers', async () => {
    await mountClosed(closedWith([{ ...FLOW, trigger: 1 }]));
    expect(find('.dh-offline-form')).not.toBeNull();
  });

  it('does not run the flow while the team is open', async () => {
    await mountClosed(published({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: true, flows: [FLOW] }));
    expect(find('.dh-flow')).toBeNull();
    expect(find('.dh-offline-form')).toBeNull();
  });

  it('sends the visitor’s answer to chat-service as an offline_flow message', async () => {
    await mountClosed(closedWith([FLOW]));
    await answerEmail('a@b.co');
    const sent = frames(AckingSocket.instances[0]!).find((f) => f.t === 'message.send');
    expect(sent?.d).toMatchObject({ content: 'a@b.co', metadata: { kind: 'offline_flow', flowId: 'flow-1', stepId: 'b' } });
    expect(botLines().at(-1)).toBe('Thanks, we will reply soon.');
  });
});

describe('a person replying takes over from the flow', () => {
  const agentReply = (socket: InstanceType<typeof AckingSocket>) =>
    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'message.new',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
        ts: Date.now(),
        // `message.new` carries a MessagePayload directly (core/src/protocol/frames.ts).
        d: {
          // Must be a real ULID/UUID: core drops any other `message.new` id as a
          // malformed frame before it ever reaches the store.
          id: '01ARZ3NDEKTSV4RRFFQ69G5FBB',
          sessionId: 'sess_live',
          senderId: 'agent_1',
          senderType: 'AGENT',
          type: 'TEXT',
          content: 'Hi, this is Sam',
          seq: 1, // the ack above carried seq 0, so this is the next in order
          createdAt: new Date().toISOString(),
        },
      }),
    });

  it('closes the flow and restores the conversation when an agent replies after the first send', async () => {
    await mountClosed(closedWith([FLOW]));
    await answerEmail('a@b.co');
    agentReply(AckingSocket.instances[0]!);
    await settle();
    expect(find('.dh-flow')).toBeNull();
    expect(find<HTMLElement>('.dh-composer')?.hidden).not.toBe(true);
  });

  it('does NOT close a fresh flow because of an agent message that was already in the history', async () => {
    await mountClosed(closedWith([FLOW]));
    agentReply(AckingSocket.instances[0]!); // arrives before the visitor has answered anything
    await settle();
    expect(find('.dh-flow')).not.toBeNull();
  });
});
