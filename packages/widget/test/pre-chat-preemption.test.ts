// @vitest-environment jsdom
//
// The pre-chat gate versus the surfaces a customer opens, end to end through
// the real widget — the two reported bugs that share one cause:
//
//   1. "New conversation" / "Send us a message" did nothing visible. With
//      `preChatEnabled` published, the gate in `syncProductSurfaces` re-ran on
//      every store tick and REPLACED the customer's half-typed new-conversation
//      form with itself; and after Start, the freshly minted session's empty
//      transcript re-armed it before the opening line could land.
//   2. A Common Questions tap flashed the pre-chat form before the chat — the
//      same empty-transcript window, seen for the length of one send.
//
// remote-config-gating.test.ts proves the gate renders when published, and
// new-conversation.test.ts proves the form collects the fields. Neither can
// see this: it is the seam between a store tick and `activeSurface`, and it
// only exists with a real store being driven by a real socket. So this file
// uses the same hand-run fake socket session-closed.test.ts does — a genuine
// `connection.hello` -> `connection.ack` for the first session, a genuine
// second socket for the minted one — with only `sendMessage` stubbed: a
// validator-correct `message.ack` is not what is under test, and a stub that
// HOLDS the send is what lets a test look at the exact window the bugs lived
// in.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import { OFFLINE_MODE } from '../src/remote-config.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

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

  /** Answers the hello with a session in `status`. Call {@link open} first. */
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

  /**
   * A `session.updated` push naming a new status for the SAME session — what
   * an agent picking up or handing off produces. Applied wholesale by core,
   * so it is a genuine `session.id:status` change for the widget's
   * subscription (a bare `session.closed` is not: that one only records the
   * closure, and would not have re-armed the gate).
   */
  updateStatus(sessionId: string, status: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'session.updated',
        id: ulid(),
        ts: Date.now(),
        d: {
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

/** The demo tenant's fields: two REQUIRED ones. */
const REQUIRED_FIELDS: unknown[] = [
  { id: 'name', label: 'Your name', type: 'text', required: true },
  { id: 'email', label: 'Email address', type: 'email', required: true },
];
/** What the published config's `preChatFields` answers with — a test overrides it BEFORE `connected()`. */
let preChatFields: unknown[] = REQUIRED_FIELDS;
/** Rows `GET /chat/sessions/customer` answers with — what Home's "Recent" row is built from. */
let sessionRows: unknown[] = [];

/** A past conversation for the sessions list — the row shape session-switch.test.ts seeds. */
function pastSession(id: string): Record<string, unknown> {
  return {
    id,
    status: 'RESOLVED',
    mode: 'HUMAN',
    createdAt: '2026-08-19T09:00:00.000Z',
    closedAt: '2026-08-19T10:00:00.000Z',
    lastMessageAt: '2026-08-19T09:30:00.000Z',
    lastMessagePreview: 'Thanks!',
    unreadCount: 0,
  };
}

/** The demo tenant's shape: pre-chat on with `preChatFields`, a topic, a Common Question. */
function publishedConfig(): unknown {
  return {
    success: true,
    data: {
      enabled: true,
      appearance: {},
      behaviour: {
        preChatEnabled: true,
        preChatFields,
        conversationTopics: [{ id: 'delivery', label: 'Delivery issue' }],
        commonQuestions: [{ id: 'track', label: 'Track my order', prompt: 'Where is my order?' }],
        // A second user-initiated surface, so this file can open one on top
        // of another — see "a detour opened on top of a detour" below.
        reportIssue: true,
      },
      offlineMode: OFFLINE_MODE.SHOW_MESSAGE,
      isOpenNow: null,
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

/** Lets the config fetch, the token mint, the socket handshake and their promise chains land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

let widget: ReturnType<typeof mount>;

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
  preChatFields = REQUIRED_FIELDS;
  sessionRows = [];
  // jsdom has no IntersectionObserver; ui/hero-header.ts constructs one on
  // mount regardless of design. A stub, not a workaround for anything here.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/widget/config')) return json(publishedConfig());
      if (url.includes('/api/chat-token')) return json({ accessToken: 'tok', expiresIn: 3600 });
      if (url.includes('/chat/sessions/customer')) return json({ success: true, data: { sessions: sessionRows } });
      // Every history page: empty, which is the precondition the gate needs.
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
 * Mounts and connects a live, EMPTY first session — the exact state a visitor
 * to the demo lands in, chat-service's hello-time mint included.
 *
 * The panel opens on HOME and the gate is not up: a session existing is not
 * the same as the customer having opened a conversation, which is what the
 * gate stands in front of. {@link connectedOnConversation} is the other
 * fixture, for the tests that need it armed.
 */
async function connected(): Promise<FakeWebSocket> {
  widget = mount(config());
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack('sess_1', 'ASSIGNED');
  await settle();
  widget.open();
  return socket;
}

/**
 * The same live, empty session, but reached as a conversation the customer is
 * ALREADY LOOKING AT: the host named it, so the panel opens straight on it
 * and the pre-chat gate is armed in front of the empty transcript.
 */
async function connectedOnConversation(): Promise<FakeWebSocket> {
  widget = mount(config({ sessionId: 'sess_1' }));
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack('sess_1', 'ASSIGNED');
  await settle();
  widget.open();
  return socket;
}

/** The socket core opened for the session it is minting. */
function newestSocket(): FakeWebSocket {
  const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (next === undefined || FakeWebSocket.instances.length < 2) throw new Error('no second socket was opened');
  return next;
}

/** The ⋯ menu's "Start new conversation" — one of the entry points the report names. */
function openStartNew(): void {
  query<HTMLButtonElement>('.dh-hmenu-toggle').click();
  const item = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-hmenu-item')].find((button) =>
    button.textContent?.includes('Start new conversation'),
  );
  if (item === undefined) throw new Error('no "Start new conversation" item');
  item.click();
}

/** The ⋯ menu's "Report an issue" — the other surface a customer opens for themselves. */
function openReportIssue(): void {
  query<HTMLButtonElement>('.dh-hmenu-toggle').click();
  const item = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-hmenu-item')].find((button) =>
    button.textContent?.includes('Report an issue'),
  );
  if (item === undefined) throw new Error('no "Report an issue" item');
  item.click();
}

/** The pre-chat inputs inside the new-conversation form (the message textarea is not an `<input>`). */
const fieldInputs = () => [...shadow().querySelectorAll<HTMLInputElement>('.dh-newconvo-form input.dh-field-input')];

interface HeldSend {
  readonly content: string;
  readonly opts: unknown;
  release(): void;
}

/**
 * Replaces `sendMessage` with one that records the call and does not resolve
 * until the test says so — the opening line held in flight, which is the
 * window both bugs lived in.
 */
function holdSends(): HeldSend[] {
  const sends: HeldSend[] = [];
  vi.spyOn(widget.store.client, 'sendMessage').mockImplementation(
    (content, opts) =>
      new Promise<void>((resolve) => {
        sends.push({ content, opts, release: resolve });
      }),
  );
  return sends;
}

describe('the pre-chat gate does not preempt a surface the customer opened', () => {
  it('folds the fields into the new-conversation form instead of gating in front of it', async () => {
    await connectedOnConversation();
    // The gate is armed — the state the bug needed.
    expect(find('.dh-prechat-form')).not.toBeNull();

    openStartNew();
    await settle();

    expect(find('.dh-prechat-form')).toBeNull();
    expect(query<HTMLElement>('.dh-newconvo-form .dh-form-heading').textContent).toBe('Start a new conversation');
    const subtitle = query<HTMLElement>('.dh-newconvo-form .dh-form-subtitle');
    expect(subtitle.hidden).toBe(false);
    expect(subtitle.textContent).toBe('A few details so we can help you faster.');
    const labels = [...shadow().querySelectorAll('.dh-newconvo-form .dh-field-label')].map((l) => l.textContent);
    expect(labels).toEqual(['Your name', 'Email address', 'Your message']);
  });

  it('keeps the form — and what was typed into it — through a store change that used to re-arm the gate', async () => {
    // Opened over an ARMED gate, so the tick below genuinely could re-arm it.
    const socket = await connectedOnConversation();
    openStartNew();
    await settle();

    const form = query<HTMLElement>('.dh-newconvo-form');
    const [name] = fieldInputs();
    if (name === undefined) throw new Error('no name field');
    name.value = 'Ada';
    query<HTMLTextAreaElement>('.dh-newconvo-message').value = 'Half typed';

    // A session status flip with the transcript still empty: exactly the
    // reading of state the gate used to take as its cue.
    socket.updateStatus('sess_1', 'WAITING_FOR_AGENT');
    await settle();

    // Same node, not a rebuilt one, and not replaced by the gate.
    expect(find('.dh-newconvo-form')).toBe(form);
    expect(find('.dh-prechat-form')).toBeNull();
    expect(name.value).toBe('Ada');
    expect(query<HTMLTextAreaElement>('.dh-newconvo-message').value).toBe('Half typed');
  });

  it('Start mints the session, sends the details then the message, and the gate never shows on the empty new session', async () => {
    await connected();
    const startNewSession = vi.spyOn(widget.store.client, 'startNewSession');
    const sends = holdSends();

    openStartNew();
    await settle();
    const [name, email] = fieldInputs();
    if (name === undefined || email === undefined) throw new Error('fields missing');
    name.value = 'Ada';
    email.value = 'ada@example.com';
    query<HTMLButtonElement>('.dh-topic-chip').click();
    query<HTMLTextAreaElement>('.dh-newconvo-message').value = 'It never arrived';
    query<HTMLButtonElement>('.dh-newconvo-form .dh-form-submit').click();
    await settle();

    // The mint carries the topic and the message-as-subject, and it is a
    // REAL second socket whose hello asks for a new session.
    expect(startNewSession).toHaveBeenCalledWith({ topic: 'Delivery issue', subject: 'It never arrived' });
    const next = newestSocket();
    next.open();
    const hello = next.sentFrames().find((frame) => frame['t'] === 'connection.hello');
    expect(hello?.['d']).toMatchObject({ newSession: true, topic: 'Delivery issue', subject: 'It never arrived' });

    next.ack('sess_2', 'WAITING_FOR_AGENT');
    await settle();

    // The moment the old code broke: a fresh session, an empty transcript,
    // no answer recorded yet. The form is still the thing on screen, busy.
    expect(find('.dh-prechat-form')).toBeNull();
    expect(find('.dh-newconvo-form')).not.toBeNull();
    const start = query<HTMLButtonElement>('.dh-newconvo-form .dh-form-submit');
    expect(start.disabled).toBe(true);
    expect(start.textContent).toBe('Starting…');

    // Details FIRST, in the exact shape the gate has always sent them.
    expect(sends).toHaveLength(1);
    expect(sends[0]?.content).toBe('Your name: Ada\nEmail address: ada@example.com');
    expect(sends[0]?.opts).toEqual({ metadata: { kind: 'pre_chat', answers: { name: 'Ada', email: 'ada@example.com' } } });
    sends[0]?.release();
    await settle();

    // Then the customer's own line, plain.
    expect(sends).toHaveLength(2);
    expect(sends[1]?.content).toBe('It never arrived');
    expect(sends[1]?.opts).toBeUndefined();
    expect(find('.dh-prechat-form')).toBeNull();
    sends[1]?.release();
    await settle();

    // Landed: the form has handed back to the conversation and nothing gates it.
    expect(find('.dh-newconvo-form')).toBeNull();
    expect(find('.dh-prechat-form')).toBeNull();
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);

    // Answered once, asked no more — the next new conversation is just a form.
    openStartNew();
    await settle();
    expect(fieldInputs()).toHaveLength(0);
    expect(query<HTMLElement>('.dh-newconvo-form .dh-form-subtitle').hidden).toBe(true);
  });

  it('a Common Questions tap goes straight to the conversation with no flash of the gate, and skips the fields', async () => {
    await connected();
    // A first visit opens on Home, where the questions live, un-gated.
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);
    expect(find('.dh-prechat-form')).toBeNull();
    const sends = holdSends();

    query<HTMLButtonElement>('.dh-common-question-row').click();
    await settle();
    const next = newestSocket();
    next.open();
    next.ack('sess_2', 'WAITING_FOR_AGENT');
    await settle();

    // Navigated on the ack, before the send has landed — and the empty new
    // session did not put the gate up in the meantime.
    expect(find('.dh-prechat-form')).toBeNull();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);

    // The prompt is the opening line, with no pre-chat details ahead of it:
    // this route deliberately does not ask.
    expect(sends).toHaveLength(1);
    expect(sends[0]?.content).toBe('Where is my order?');
    sends[0]?.release();
    await settle();
    expect(find('.dh-prechat-form')).toBeNull();

    // Never asked, so not recorded as answered: the next new-conversation
    // form still carries the fields.
    openStartNew();
    await settle();
    expect(fieldInputs()).toHaveLength(2);
  });
});

/** The ⋯ menu's "End conversation" — offered only while the session is live. */
function pressEndConversation(): void {
  query<HTMLButtonElement>('.dh-hmenu-toggle').click();
  const item = query<HTMLButtonElement>('.dh-hmenu-danger');
  expect(item.hidden).toBe(false);
  item.click();
}

describe('a surface the customer walked away from does not cover the next conversation', () => {
  // The other edge of the non-preemption rule. Before it, the next store
  // tick's fall-through `closeSurface` swept an abandoned form out of the
  // slot; with it, nothing ever ticks one away — so leaving the conversation
  // screen has to be the moment the widget lets go, or the conversation the
  // customer opens next (a Common Question, a recent row) is drawn UNDER the
  // stale form, and a Start pressed on that form mints a session nobody
  // asked for.

  it('Back drops a half-typed new-conversation form; the Common Question tapped next gets the screen', async () => {
    await connected();
    const startNewSession = vi.spyOn(widget.store.client, 'startNewSession');
    openStartNew();
    await settle();
    query<HTMLTextAreaElement>('.dh-newconvo-message').value = 'half typed';

    query<HTMLButtonElement>('.dh-back').click();
    await settle();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);
    // Gone the moment the customer left — not parked behind Home.
    expect(find('.dh-newconvo-form')).toBeNull();

    const sends = holdSends();
    query<HTMLButtonElement>('.dh-common-question-row').click();
    await settle();
    const next = newestSocket();
    next.open();
    next.ack('sess_2', 'WAITING_FOR_AGENT');
    await settle();

    // The tapped question's conversation is what is on screen — transcript
    // and composer, nothing standing in for them — and it is the ONLY
    // session minted: no stale Start left to press.
    expect(find('.dh-newconvo-form')).toBeNull();
    expect(query<HTMLElement>('.dh-surface-host').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
    expect(startNewSession).toHaveBeenCalledTimes(1);
    expect(startNewSession).toHaveBeenCalledWith({ subject: 'Where is my order?' });
    expect(sends.map((send) => send.content)).toEqual(['Where is my order?']);
    sends[0]?.release();
  });

  it('Back then "Send us a message" opens a FRESH form rather than doing nothing', async () => {
    await connected();
    openStartNew();
    await settle();
    const stale = query<HTMLElement>('.dh-newconvo-form');
    query<HTMLTextAreaElement>('.dh-newconvo-message').value = 'half typed';
    query<HTMLButtonElement>('.dh-back').click();
    await settle();

    query<HTMLButtonElement>('.dh-home-cta').click();
    await settle();

    // A new form on the conversation screen. Had the old one still held the
    // slot, `openSurface`'s idempotence-by-kind would have answered the tap
    // with it and never navigated — the reported "does nothing".
    const fresh = query<HTMLElement>('.dh-newconvo-form');
    expect(fresh).not.toBe(stale);
    expect(query<HTMLTextAreaElement>('.dh-newconvo-message').value).toBe('');
    expect(query<HTMLElement>('.dh-home').hidden).toBe(true);
  });

  it('Back drops the "End this conversation?" question; the recent row picked next opens THAT conversation, closing nothing', async () => {
    sessionRows = [pastSession('sess_past')];
    await connected();
    const closeSession = vi.spyOn(widget.store.client, 'closeSession');
    pressEndConversation();
    await settle();
    expect(find('.dh-confirm-end')).not.toBeNull();

    query<HTMLButtonElement>('.dh-back').click();
    await settle();
    expect(find('.dh-confirm-end')).toBeNull();

    query<HTMLButtonElement>('.dh-home-recent-row').click();
    await settle();

    expect(find('.dh-confirm-end')).toBeNull();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);
    expect(closeSession).not.toHaveBeenCalled();
  });
});

/** The bottom tab bar's Messages tab — a sibling swap, so it pushes no history. */
function goToMessages(): void {
  const tab = [...shadow().querySelectorAll<HTMLButtonElement>('.dh-nav-tab')].find((button) =>
    button.textContent?.includes('Messages'),
  );
  if (tab === undefined) throw new Error('no Messages tab');
  tab.click();
}

/** The new-conversation form's own Cancel (`.dh-form-skip`, shared with the other forms). */
function pressCancel(): void {
  query<HTMLButtonElement>('.dh-newconvo-form .dh-form-skip').click();
}

describe('Cancel returns the customer to the screen the form was opened from', () => {
  // The reported defect: `closeSurface` always ended in `showConversation`,
  // so backing out of the new-conversation form put the customer on the
  // conversation screen — an empty transcript with the tab bar gone —
  // whichever screen they had actually pressed from. Start is unaffected:
  // that one HAS a conversation to show, and the test above pins it.

  it('opened from Home: Cancel lands back on Home with nothing in the surface slot', async () => {
    await connected();
    // A first visit opens on Home, where "Send us a message" lives.
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);

    query<HTMLButtonElement>('.dh-home-cta').click();
    await settle();
    expect(find('.dh-newconvo-form')).not.toBeNull();

    pressCancel();
    await settle();

    expect(find('.dh-newconvo-form')).toBeNull();
    expect(query<HTMLElement>('.dh-surface-host').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);
    // The tab bar is the other half of "this is Home" — the conversation
    // screen hides it.
    expect(query<HTMLElement>('.dh-nav').hidden).toBe(false);
  });

  it('opened from Messages: Cancel lands back on Messages, not on Home and not in the conversation', async () => {
    await connected();
    goToMessages();
    await settle();
    expect(query<HTMLElement>('.dh-messages').hidden).toBe(false);

    query<HTMLButtonElement>('.dh-messages-new').click();
    await settle();
    expect(find('.dh-newconvo-form')).not.toBeNull();

    pressCancel();
    await settle();

    expect(find('.dh-newconvo-form')).toBeNull();
    expect(query<HTMLElement>('.dh-surface-host').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-messages').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-home').hidden).toBe(true);
  });

  // The ⋯ menu is in the always-visible header, so "End conversation" is
  // reachable from Home too — and the answer that changes nothing must leave
  // the customer exactly where they were. This one cancelled through
  // `releaseSurface` while the other two used `cancelUserSurface`, so it
  // stranded them on an empty conversation screen with the tab bar gone.
  it('opened from Home: "Keep chatting" lands back on Home, closing nothing', async () => {
    await connected();
    const closeSession = vi.spyOn(widget.store.client, 'closeSession');
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);

    pressEndConversation();
    await settle();
    expect(find('.dh-confirm-end')).not.toBeNull();

    query<HTMLButtonElement>('.dh-confirm-end-keep').click();
    await settle();

    expect(find('.dh-confirm-end')).toBeNull();
    expect(query<HTMLElement>('.dh-surface-host').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-nav').hidden).toBe(false);
    expect(closeSession).not.toHaveBeenCalled();
  });

  // A detour opened on top of a detour. `openSurface` navigates to the
  // conversation screen on its way in, so by the time the SECOND one is
  // opened `screens.current()` says 'conversation' — the first surface put it
  // there, not the customer. Reading the origin from the screen at that
  // moment recorded 'conversation' for a form pressed on Home, and its Cancel
  // then fell through to `releaseSurface`: the customer landed on an empty
  // transcript having pressed Cancel, which is the defect this whole block is
  // about.
  it('a second surface opened on top of the first still cancels back to Home', async () => {
    await connected();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);

    openStartNew();
    await settle();
    expect(find('.dh-newconvo-form')).not.toBeNull();

    // Without leaving the form, the customer changes their mind about which
    // thing they came to do.
    openReportIssue();
    await settle();
    expect(find('.dh-newconvo-form')).toBeNull();
    expect(find('.dh-report-form')).not.toBeNull();

    query<HTMLButtonElement>('.dh-report-form .dh-form-skip').click();
    await settle();

    expect(find('.dh-report-form')).toBeNull();
    expect(query<HTMLElement>('.dh-surface-host').hidden).toBe(true);
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);
    expect(query<HTMLElement>('.dh-nav').hidden).toBe(false);
  });

  it('opened from the conversation itself: Cancel gives that conversation back', async () => {
    await connectedOnConversation();
    // Straight from the ⋯ menu, with the panel already on the conversation
    // screen — the case that must NOT navigate anywhere.
    openStartNew();
    await settle();
    expect(find('.dh-newconvo-form')).not.toBeNull();

    pressCancel();
    await settle();

    expect(find('.dh-newconvo-form')).toBeNull();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(true);
    // And the gate that was standing here before the form is back, which is
    // `releaseSurface`'s re-sync doing its job.
    expect(find('.dh-prechat-form')).not.toBeNull();
  });
});

describe('an all-optional set of details left blank', () => {
  // `sendPreChatDetails`'s "nothing answered, nothing sent" rule, on the
  // form route: an empty-content `pre_chat` message tells the agent nothing,
  // so the opening line is the first and only frame — and the customer still
  // counts as asked, the same way Skip on the gate does.
  it('sends only the opening line from the new-conversation form, and counts as answered', async () => {
    preChatFields = [{ id: 'order', label: 'Order number', type: 'text', required: false }];
    await connected();
    const sends = holdSends();

    openStartNew();
    await settle();
    expect(fieldInputs()).toHaveLength(1);
    query<HTMLTextAreaElement>('.dh-newconvo-message').value = 'It never arrived';
    query<HTMLButtonElement>('.dh-newconvo-form .dh-form-submit').click();
    await settle();
    const next = newestSocket();
    next.open();
    next.ack('sess_2', 'WAITING_FOR_AGENT');
    await settle();

    expect(sends.map((send) => [send.content, send.opts])).toEqual([['It never arrived', undefined]]);
    sends[0]?.release();
    await settle();
    expect(find('.dh-newconvo-form')).toBeNull();
    // Recorded as answered: the empty new session does not re-arm the gate…
    expect(find('.dh-prechat-form')).toBeNull();
    expect(query<HTMLElement>('.dh-composer').hidden).toBe(false);

    // …and the next form carries no fields.
    openStartNew();
    await settle();
    expect(fieldInputs()).toHaveLength(0);
  });
});

describe('an opening exchange whose form the customer walked away from', () => {
  // `startNewConversation` awaits a full mint round trip, and the panel stays
  // live across it: Back is on screen and so is the ⋯ menu. Core addresses
  // every send to whichever session is current when `sendMessage` is CALLED
  // (`MessagesController.#send`), so a continuation that ran after the
  // customer moved on filed this form's pre-chat answers — their name, email,
  // phone — and their message against whatever conversation they opened
  // instead, and left the one they actually asked for empty.
  //
  // The second half is the in-flight latch. It used to be one shared boolean,
  // so the SECOND flow's `finally` cleared it while the first was still
  // mid-exchange and re-armed the pre-chat gate on an empty session, in
  // exactly the window the latch exists to cover.
  it('stops sending, and keeps the gate down while the other exchange is still running', async () => {
    const socket = await connected();
    const sends = holdSends();
    // Held mints, so both flows can be alive at once — the overlap is the
    // whole point, and a real socket handshake cannot be paused mid-way.
    const mints: Array<() => void> = [];
    vi.spyOn(widget.store.client, 'startNewSession').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          mints.push(resolve);
        }),
    );

    openStartNew();
    await settle();
    const [name, email] = fieldInputs();
    if (name === undefined || email === undefined) throw new Error('fields missing');
    name.value = 'Jane Doe';
    email.value = 'jane@example.com';
    query<HTMLTextAreaElement>('.dh-newconvo-message').value = "Where's my refund?";
    query<HTMLButtonElement>('.dh-newconvo-form .dh-form-submit').click();
    await settle();
    expect(mints).toHaveLength(1);

    // Back, while the mint is still in flight: the form is discarded.
    query<HTMLButtonElement>('.dh-back').click();
    await settle();
    expect(find('.dh-newconvo-form')).toBeNull();
    expect(query<HTMLElement>('.dh-home').hidden).toBe(false);

    // On Home they tap a Common Question, which mints a conversation of its own.
    query<HTMLButtonElement>('.dh-common-question-row').click();
    await settle();
    expect(mints).toHaveLength(2);
    mints[1]?.();
    await settle();

    // That conversation's opening line, and nothing else.
    expect(sends.map((send) => send.content)).toEqual(['Where is my order?']);

    // Its send lands, and its own `finally` runs — but the abandoned exchange
    // is still in flight, so the gate stays down on the empty transcript.
    sends[0]?.release();
    await settle();
    socket.updateStatus('sess_1', 'WAITING_FOR_AGENT');
    await settle();
    expect(find('.dh-prechat-form')).toBeNull();

    // And the abandoned exchange, when it finally resolves, says nothing at
    // all: no `pre_chat` frame addressed to the Common Question's
    // conversation, and no second copy of the customer's message.
    mints[0]?.();
    await settle();
    expect(sends.map((send) => send.content)).toEqual(['Where is my order?']);
    expect(sends.some((send) => send.opts !== undefined)).toBe(false);
  });
});
