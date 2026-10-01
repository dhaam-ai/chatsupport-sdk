// @vitest-environment jsdom
//
// A flow's buttons (chatbot-workflows.md §9.4-9.5, §11.2), through a mounted
// widget: they render under the newest bot message, a tap sends `flow_reply`
// metadata with the label as content, and a tap never also fires the widget's
// own keyword escalation — the flow engine owns that inside a flow.
// Fixtures are remote-config-gating.test.ts's, with the session in BOT mode.

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
            mode: 'BOT',
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

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let ulidCounter = 1;
const ulid = (): string => {
  const c = ULID_ALPHABET[ulidCounter++ % 32] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${c}${c}`;
};

type Frame = { t: string; d: Record<string, unknown> };
const sentFrames = (type: string): Frame[] =>
  AckingSocket.instances.flatMap((s) => s.sent.map((raw) => JSON.parse(raw) as Frame)).filter((f) => f.t === type);

function botMessage(seq: number, content: string, metadata?: Record<string, unknown>): void {
  AckingSocket.instances[0]!.onmessage?.({
    data: JSON.stringify({
      v: 1,
      t: 'message.new',
      id: ulid(),
      ts: Date.now(),
      d: {
        id: ulid(),
        sessionId: 'sess_live',
        senderId: 'ai-bot',
        senderType: 'BOT',
        type: 'TEXT',
        content,
        seq,
        createdAt: new Date().toISOString(),
        ...(metadata === undefined ? {} : { metadata }),
      },
    }),
  });
}

const FLOW = { runId: 'run-1', stepId: 'choose', kind: 'buttons' };
const BUTTONS = [
  { id: 'b1', label: 'Payment failed' },
  { id: 'b2', label: 'Talk to a person' },
];

const chips = (): HTMLButtonElement[] => [...shadow().querySelectorAll<HTMLButtonElement>('.dh-quick-reply')];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mountWithButtons(overrides: { flow?: unknown } = {}) {
  stubFetch(published({ behaviour: { handoffKeywords: ['person'] } }));
  vi.stubGlobal('WebSocket', AckingSocket);
  const widget = mount(config({ sessionId: 'sess_live' }));
  await settle();
  AckingSocket.instances[0]!.ack('sess_live');
  await settle();
  widget.open();
  await settle();
  botMessage(1, 'Stuck at checkout? Pick one:', {
    flow: 'flow' in overrides ? overrides.flow : FLOW,
    buttons: BUTTONS,
    options: BUTTONS.map((b) => b.label),
  });
  await settle();
  return widget;
}

describe('flow buttons', () => {
  it('render as chips under the newest bot message, in order', async () => {
    await mountWithButtons();
    expect(chips().map((c) => c.textContent)).toEqual(['Payment failed', 'Talk to a person']);
  });

  it('a tap sends the label with flow_reply metadata', async () => {
    await mountWithButtons();
    chips()[0]!.click();
    await settle();

    const sent = sentFrames('message.send').at(-1);
    expect(sent?.d['content']).toBe('Payment failed');
    expect(sent?.d['metadata']).toEqual({ kind: 'flow_reply', runId: 'run-1', stepId: 'choose', buttonId: 'b1' });
  });

  it('a tap on a button that reads like "talk to a person" does not also escalate', async () => {
    await mountWithButtons();
    chips()[1]!.click();
    await settle();

    expect(sentFrames('message.send').at(-1)?.d['content']).toBe('Talk to a person');
    expect(sentFrames('session.requestAgent')).toEqual([]);
  });

  it('are retired once the visitor has answered', async () => {
    await mountWithButtons();
    chips()[0]!.click();
    await settle();
    await pause(50);
    expect(chips()).toEqual([]);
  });

  it('are retired when a newer bot message arrives without buttons', async () => {
    await mountWithButtons();
    botMessage(2, 'Thanks — anything else?');
    await settle();
    expect(chips()).toEqual([]);
  });

  it('still send their label as plain text when the flow block is malformed', async () => {
    await mountWithButtons({ flow: 'not-an-object' });
    chips()[0]!.click();
    await settle();

    const sent = sentFrames('message.send').at(-1);
    expect(sent?.d['content']).toBe('Payment failed');
    expect(sent?.d['metadata']).toBeUndefined();
  });
});

describe('a flow question’s input type', () => {
  const box = () => shadow().querySelector<HTMLTextAreaElement>('.dh-input')!;

  async function mountAsked(type: string) {
    stubFetch(published());
    vi.stubGlobal('WebSocket', AckingSocket);
    const widget = mount(config({ sessionId: 'sess_live' }));
    await settle();
    AckingSocket.instances[0]!.ack('sess_live');
    await settle();
    widget.open();
    await settle();
    botMessage(1, 'What is your email?', { flow: { runId: 'run-1', stepId: 'ask', kind: 'question' }, input: { type } });
    await settle();
    return widget;
  }

  it('raises the matching keyboard and prompt while the question is the newest message', async () => {
    await mountAsked('email');
    expect(box().getAttribute('inputmode')).toBe('email');
    expect(box().placeholder).toBe('Your email address');
  });

  it('does the same for a phone question', async () => {
    await mountAsked('phone');
    expect(box().getAttribute('inputmode')).toBe('tel');
    expect(box().placeholder).toBe('Your phone number');
  });

  it('leaves the box alone for a type it does not know', async () => {
    await mountAsked('password');
    expect(box().getAttribute('inputmode')).toBeNull();
    expect(box().placeholder).toBe('Type your message...');
  });

  it('hands the ordinary keyboard back once the visitor has answered', async () => {
    await mountAsked('email');
    box().value = 'a@b.co';
    box().dispatchEvent(new Event('input'));
    shadow().querySelector<HTMLButtonElement>('.dh-send')!.click();
    await settle();

    expect(box().getAttribute('inputmode')).toBeNull();
    expect(box().placeholder).toBe('Type your message...');
  });

  it('hands it back when a newer bot message asks nothing special', async () => {
    await mountAsked('email');
    botMessage(2, 'Thanks. Anything else?');
    await settle();
    expect(box().getAttribute('inputmode')).toBeNull();
    expect(box().placeholder).toBe('Type your message...');
  });

  it('still lets the visitor type anything', async () => {
    await mountAsked('email');
    box().value = 'no thanks';
    box().dispatchEvent(new Event('input'));
    shadow().querySelector<HTMLButtonElement>('.dh-send')!.click();
    await settle();
    expect(sentFrames('message.send').at(-1)?.d['content']).toBe('no thanks');
  });
});
