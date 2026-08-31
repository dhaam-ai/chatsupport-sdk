// @vitest-environment jsdom
//
// The closed-conversation dead end, end to end through the real widget.
//
// Before this was handled, `grep -rn "sessionClosed" packages/widget/src/`
// returned nothing: core applied the close to session state and emitted the
// §6.5 event, and the widget listened to neither. An agent resolving a chat
// therefore left the customer with a transcript that silently stopped working
// — no explanation, and no way to start another conversation.
//
// Driven through a hand-run fake socket (the same shape core's own
// transport/stub-socket.ts uses, which is not in this package's dependency
// graph) so the real `connection.hello` -> `connection.ack` handshake runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';

/** A valid 26-char ULID per call — the envelope `id` is ULID-validated. */
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

  /** Fires the socket open, which is when the transport writes its hello. */
  open(): void {
    this.onopen?.();
  }

  /** Answers the hello. Call {@link open} first. */
  ack(sessionId: string, status = 'ASSIGNED'): void {
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

  closeSession(sessionId: string, closeReason: 'RESOLVED' | 'MANUAL' | 'SWITCHED'): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'session.closed',
        id: ulid(),
        ts: Date.now(),
        d: { sessionId, closeReason },
      }),
    });
  }
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: API_URL,
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

/** Lets the token fetch and the socket construction settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function connected(sessionId = 'sess_1'): Promise<FakeWebSocket> {
  mount(config());
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack(sessionId);
  await settle();
  return socket;
}

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
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

describe('an agent closing the conversation', () => {
  it('tells the customer, and does not leave the composer silently inert', async () => {
    const socket = await connected();
    const composerInput = query<HTMLTextAreaElement>('.dh-composer-input, textarea');
    expect(composerInput.disabled).toBe(false);

    socket.closeSession('sess_1', 'RESOLVED');
    await settle();

    const closure = query<HTMLElement>('.dh-system');
    expect(closure.hidden).toBe(false);
    expect(query<HTMLElement>('.dh-system-text').textContent).toBe(
      'This conversation was marked resolved.',
    );
    expect(composerInput.disabled).toBe(true);
  });

  it('announces the close through the live region', async () => {
    const socket = await connected();
    socket.closeSession('sess_1', 'RESOLVED');
    await settle();

    expect(query<HTMLElement>('.dh-sr[role="status"]').textContent).toContain(
      'This conversation was marked resolved.',
    );
  });

  it('says nothing at all for SWITCHED — that session is parked, not ended', async () => {
    const socket = await connected();
    socket.closeSession('sess_1', 'SWITCHED');
    await settle();

    // §12.5's parked reason. Telling the customer their conversation ended
    // would simply be false.
    expect(query<HTMLElement>('.dh-system').hidden).toBe(true);
    expect(query<HTMLTextAreaElement>('.dh-composer-input, textarea').disabled).toBe(false);
  });

  it('opens a genuinely new session when the customer asks for one', async () => {
    const socket = await connected();
    socket.closeSession('sess_1', 'RESOLVED');
    await settle();

    // `.dh-system-action` now opens the same new-conversation surface every
    // other "start a conversation" affordance opens (Home's CTA, Messages'
    // own button, the ⋯ menu) rather than minting a session on the spot —
    // see widget.ts's `openNewConversationFlow`. The customer still has to
    // type something and press Start.
    query<HTMLButtonElement>('.dh-system-action').click();
    await settle();
    query<HTMLTextAreaElement>('.dh-newconvo-message').value = 'Actually, one more thing';
    query<HTMLButtonElement>('.dh-newconvo-form .dh-form-submit').click();
    await settle();

    // A second socket, carrying a hello with NO resumeFrom — which is what
    // makes the server mint a new session rather than refuse the cursor.
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (next === undefined) throw new Error('no reconnect socket');

    next.open();
    const hello = next.sentFrames().find((frame) => frame['t'] === 'connection.hello');
    expect(hello).toBeDefined();
    expect(hello?.['d']).not.toHaveProperty('resumeFrom');

    next.ack('sess_2', 'WAITING_FOR_AGENT');
    await settle();

    // Recovered: the closing line is gone and the customer can type again.
    expect(query<HTMLElement>('.dh-system').hidden).toBe(true);
    expect(query<HTMLTextAreaElement>('.dh-composer-input, textarea').disabled).toBe(false);
  });

  it('keeps the closing line up while the new session is still being opened', async () => {
    const socket = await connected();
    socket.closeSession('sess_1', 'RESOLVED');
    await settle();

    query<HTMLButtonElement>('.dh-system-action').click();
    await settle();

    // `startNewSession` blanks `session` before the new ack lands. Dropping
    // the closing line in that window would strand a customer whose reconnect
    // then failed, with nothing on screen to try again from.
    expect(query<HTMLElement>('.dh-system').hidden).toBe(false);
  });

  it('cannot be double-submitted into two sessions', async () => {
    const socket = await connected();
    socket.closeSession('sess_1', 'RESOLVED');
    await settle();

    query<HTMLButtonElement>('.dh-system-action').click();
    await settle();
    query<HTMLTextAreaElement>('.dh-newconvo-message').value = 'Actually, one more thing';

    // The double-submit guard now lives on the new-conversation surface's
    // own Start button (ui/forms.ts's submitOnce) rather than on
    // `.dh-system-action`, which only ever navigates to that surface and has
    // nothing async of its own to guard.
    const start = query<HTMLButtonElement>('.dh-newconvo-form .dh-form-submit');
    const before = FakeWebSocket.instances.length;
    start.click();
    start.click();
    start.click();
    await settle();

    expect(start.disabled).toBe(true);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });
});
