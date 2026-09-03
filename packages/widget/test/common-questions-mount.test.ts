// @vitest-environment jsdom
//
// The end-to-end half of the Common Questions bug: a REAL mounted widget, a
// published config carrying `behaviour.commonQuestions`, and the assertion
// that tapping a row actually produces a visible conversation.
//
// common-questions.test.ts already proves the component's own rendering and
// click wiring in isolation; this file exercises the seam widget.ts owns —
// the same split remote-config-gating.test.ts's own header documents, for
// the same reason: a component whose `onSelect` fires correctly and a widget
// that wires it to nothing useful are two different bugs, and only this file
// can catch the second one.
//
// ── The bug this pins ─────────────────────────────────────────────────────
//
// Common Questions render only before a conversation exists (see
// common-questions.ts's own header), which means `state.session` is `null`
// at the exact moment a customer can see a row to tap. The old wiring called
// `store.client.sendMessage(question.prompt)` directly — no session, so core
// throws `NoActiveSessionError` (packages/core/src/messages/controller.ts)
// on essentially every real tap, swallowed by `.catch(report)`. Nothing
// visible happened because nothing DID.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import { OFFLINE_MODE } from '../src/remote-config.js';
import type { WidgetConfig } from '../src/config.js';

const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

/**
 * A socket that never progresses past CONNECTING — lifted from
 * remote-config-gating.test.ts's own fixture of the same name. Common
 * Questions render before any session exists, so a test proving what
 * happens when one is tapped needs the widget to stay in exactly that
 * state rather than actually connecting.
 */
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
 * session — what chat-service's own `handleHello` does for every visitor,
 * first-timers included.
 *
 * The pre-chat gate stands in front of a conversation the customer OPENED
 * (see `syncProductSurfaces`): a first visit lands on Home and is not gated
 * at all, because the new-conversation form is what collects the details
 * now. So the one test below that needs the gate ARMED has to open a
 * conversation first, and that takes a real ack — `SilentSocket` above
 * deliberately never gets one.
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
    onError: () => undefined,
    ...overrides,
  };
}

function publishedConfig(
  commonQuestions: readonly Record<string, string>[],
  behaviour: Record<string, unknown> = {},
): unknown {
  return {
    success: true,
    data: {
      enabled: true,
      appearance: {},
      behaviour: { commonQuestions, ...behaviour },
      offlineMode: OFFLINE_MODE.SHOW_MESSAGE,
      isOpenNow: null,
      flows: [],
      publishedVersion: 1,
    },
  };
}

function stubFetch(configBody: unknown, sessions: readonly unknown[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/widget/config')) {
        return new Response(JSON.stringify(configBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/chat/sessions/customer')) {
        return new Response(JSON.stringify({ success: true, data: { sessions } }), {
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

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const QUESTION = { id: 'track', label: 'Track my order', prompt: 'Where is my order?' };

/** One past conversation, so Home offers its "Recent conversation" row. */
const PAST_SESSION = {
  id: 'sess_past',
  status: 'RESOLVED',
  mode: 'HUMAN',
  createdAt: '2026-08-19T09:00:00.000Z',
  closedAt: '2026-08-19T10:00:00.000Z',
  lastMessageAt: '2026-08-19T09:30:00.000Z',
  lastMessagePreview: 'Thanks!',
  unreadCount: 0,
};

beforeEach(() => {
  AckingSocket.instances = [];
  vi.stubGlobal('WebSocket', SilentSocket);
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('tapping a Common Questions row', () => {
  it('mints a session and sends the tapped prompt into it, mint before send', async () => {
    stubFetch(publishedConfig([QUESTION]));
    const widget = mount(config());
    await settle();

    const startNew = vi.spyOn(widget.store.client, 'startNewSession').mockResolvedValue();
    const sendMessage = vi.spyOn(widget.store.client, 'sendMessage').mockResolvedValue();

    widget.open();
    await settle();

    query<HTMLButtonElement>('.dh-common-question-row').click();
    await settle();

    // `subject`, no `topic` — a tapped question already IS the subject, the
    // same "no topic collected here" contract `startNewConversation` follows
    // when the new-conversation surface's chip chooser is skipped.
    expect(startNew).toHaveBeenCalledWith(expect.objectContaining({ subject: QUESTION.prompt }));
    expect(sendMessage).toHaveBeenCalledWith(QUESTION.prompt);
    // The mint has to land before the send: sending into a session besides
    // the one just minted would be `startNewConversation`'s already-guarded
    // mistake (see session-picker-mount.test.ts's own note on the two
    // client calls not being interchangeable).
    const mintOrder = startNew.mock.invocationCallOrder[0];
    const sendOrder = sendMessage.mock.invocationCallOrder[0];
    expect(mintOrder).toBeDefined();
    expect(sendOrder).toBeDefined();
    expect(mintOrder as number).toBeLessThan(sendOrder as number);
  });

  it('puts the resulting conversation on screen — the visible half of the reported bug', async () => {
    stubFetch(publishedConfig([QUESTION]));
    const widget = mount(config());
    await settle();
    vi.spyOn(widget.store.client, 'startNewSession').mockResolvedValue();
    vi.spyOn(widget.store.client, 'sendMessage').mockResolvedValue();

    widget.open();
    await settle();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);

    query<HTMLButtonElement>('.dh-common-question-row').click();
    await settle();

    expect(query<HTMLElement>('.dh-home').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
  });

  it('reports rather than throwing when no session could be minted — the ORIGINAL failure mode, now visible instead of silent', async () => {
    stubFetch(publishedConfig([QUESTION]));
    const onError = vi.fn();
    const widget = mount(config({ onError }));
    await settle();
    vi.spyOn(widget.store.client, 'startNewSession').mockRejectedValue(new Error('offline'));

    widget.open();
    await settle();

    expect(() => query<HTMLButtonElement>('.dh-common-question-row').click()).not.toThrow();
    await settle();

    // The old bug was `sendMessage`'s `NoActiveSessionError` reaching
    // `report` with the customer seeing nothing at all. The new wiring can
    // still fail (no network is still no network) but it must fail through
    // the same reporting channel rather than an unhandled rejection.
    expect(onError).toHaveBeenCalled();
  });
});

describe('tapping a Common Questions row while the pre-chat gate is armed', () => {
  // pre-chat-preemption.test.ts drives this same tap over a real socket,
  // where the new session's ack tick is what tears the gate down. This one
  // stubs the mint so NO tick happens, and pins that `startCommonQuestion`
  // releases the gate itself rather than relying on the side effect — the
  // difference between the two is one explicit `syncProductSurfaces()` in
  // widget.ts.
  //
  // Arming the gate takes a conversation the customer OPENED — merely having
  // a session is no longer enough, because chat-service hands one to every
  // visitor on the handshake and a first visit still lands on Home (the
  // "never gates a visitor" test below). So this drives the real route: Home,
  // the recent-conversation row, and the empty transcript that comes back.
  // The gate then parks behind Home when the customer presses Back, which is
  // the state this test needs at the moment of the tap.
  it('reaches the conversation with the gate gone, even when no store change does it for us', async () => {
    stubFetch(
      publishedConfig([QUESTION], {
        preChatEnabled: true,
        preChatFields: [{ id: 'name', label: 'Your name', type: 'text', required: true }],
      }),
      [PAST_SESSION],
    );
    vi.stubGlobal('WebSocket', AckingSocket);
    const widget = mount(config());
    await settle();
    AckingSocket.instances[0]?.ack('sess_live');
    await settle();

    widget.open();
    await settle();
    // A first visit lands on Home, un-gated, with the questions on screen.
    expect(shadow().querySelector('.dh-prechat-form')).toBeNull();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);

    // Opening the recent conversation is what arms the gate: an empty
    // transcript the customer is now looking at.
    query<HTMLButtonElement>('.dh-home-recent-row').click();
    await settle();
    AckingSocket.instances[1]?.ack('sess_past');
    await settle();
    expect(query<HTMLElement>('.dh-prechat-form')).not.toBeNull();

    const startNewSession = vi.spyOn(widget.store.client, 'startNewSession').mockResolvedValue();
    const sendMessage = vi.spyOn(widget.store.client, 'sendMessage').mockResolvedValue();

    // Back to Home, where the questions live — the gate is parked behind it,
    // still holding the slot, because no tick ever clears one.
    query<HTMLButtonElement>('.dh-back').click();
    await settle();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);
    expect(startNewSession).not.toHaveBeenCalled();

    query<HTMLButtonElement>('.dh-common-question-row').click();
    await settle();

    expect(shadow().querySelector('.dh-prechat-form')).toBeNull();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
    // And the details were deliberately not asked for on this route.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(QUESTION.prompt);
  });

  // The boot-time half of the same rule, and the reported bug: with the gate
  // published, the widget used to open the standalone form at MOUNT and
  // navigate to the conversation screen with it — so Home, and the very rows
  // this file is about, were reachable only by pressing Back off a form
  // nobody had asked for.
  //
  // Over the ACKING socket, because that is the state a real first visit is
  // in: chat-service mints or resumes a session on the handshake, so the
  // store holds a live, empty one here. Having a session is not having
  // OPENED a conversation, and only the second one arms the gate.
  it('never gates a first visit — Home and its questions are what it opens on', async () => {
    stubFetch(
      publishedConfig([QUESTION], {
        preChatEnabled: true,
        preChatFields: [{ id: 'name', label: 'Your name', type: 'text', required: true }],
      }),
    );
    vi.stubGlobal('WebSocket', AckingSocket);
    const widget = mount(config());
    await settle();
    AckingSocket.instances[0]?.ack('sess_live');
    await settle();
    widget.open();
    await settle();

    expect(widget.store.getState().session).not.toBeNull();
    expect(shadow().querySelector('.dh-prechat-form')).toBeNull();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-common-question-row')).not.toBeNull();
  });
});
