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

function publishedConfig(commonQuestions: readonly Record<string, string>[]): unknown {
  return {
    success: true,
    data: {
      enabled: true,
      appearance: {},
      behaviour: { commonQuestions },
      offlineMode: OFFLINE_MODE.SHOW_MESSAGE,
      isOpenNow: null,
      flows: [],
      publishedVersion: 1,
    },
  };
}

function stubFetch(configBody: unknown): void {
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
        return new Response(JSON.stringify({ success: true, data: { sessions: [] } }), {
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

beforeEach(() => {
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
