// @vitest-environment jsdom
//
// Bug: every Retry click spawned another failed bubble with its own Retry
// button.
//
// The cause was one line — `sendMessage(message.content)` mints a NEW ULID,
// and that id IS the permanent message id (D1). A "retry" that mints a fresh
// id is not a retry at all: it is a second, independent message that fails
// independently, so the user watched their one question multiply down the
// transcript. `retryMessage(id)` replays the ORIGINAL envelope under its
// original id, which the server dedupes on
// (`@@unique([chatSessionId, clientMessageId])`).
//
// The assertions below are therefore about IDENTITY, not about success: what
// makes the fix correct is that the id on the wire is the same one, and that
// `messages` still holds exactly one message afterwards.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { ChatWidget } from '../src/widget.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

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

  frames(type: string): Array<{ id: string; d: Record<string, unknown> }> {
    return this.sent
      .map((raw) => JSON.parse(raw) as { t: string; id: string; d: Record<string, unknown> })
      .filter((frame) => frame.t === type);
  }

  ack(sessionId = 'sess_1'): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
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

  /** Rejects one client frame by `ref`, the way a server refuses a `message.send`. */
  reject(ref: string, retryable: boolean): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'error',
        id: `01ARZ3NDEKTSV4RRFFQ69G5FE${retryable ? '1' : '0'}`,
        ref,
        ts: Date.now(),
        d: { code: 'INTERNAL', message: 'server said no', retryable },
      }),
    });
  }
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

const retryButtons = (): HTMLButtonElement[] =>
  [...shadow().querySelectorAll<HTMLButtonElement>('.dh-retry')].filter((button) => !button.hidden);

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A mounted, connected widget holding exactly one permanently-failed message. */
async function withFailedMessage(
  retryable = true,
): Promise<{ widget: ChatWidget; socket: FakeWebSocket; messageId: string }> {
  const widget = mount(config());
  await settle();

  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack();
  await settle();

  await widget.store.client.sendMessage('where is my order?');
  await settle();

  const sends = socket.frames('message.send');
  const first = sends[0];
  if (first === undefined) throw new Error('no message.send reached the wire');

  socket.reject(first.id, retryable);
  await settle();

  return { widget, socket, messageId: first.id };
}

beforeEach(() => {
  // The widget's client now persists to `localStorage` (client.ts) — the send
  // queue and the chosen session both have to survive a reload. That makes it
  // shared state between tests in this file, so it is cleared like any other:
  // one test's queued-but-failed message must not rehydrate into the next
  // test's freshly mounted widget.
  localStorage.clear();
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

describe('retrying a failed send', () => {
  it('replays the original envelope id rather than minting a new message', async () => {
    const { socket, messageId } = await withFailedMessage();

    const before = socket.frames('message.send').length;
    expect(before).toBe(1);

    const button = retryButtons()[0];
    if (button === undefined) throw new Error('no retry button was offered');
    button.click();
    await settle();

    const sends = socket.frames('message.send');
    expect(sends).toHaveLength(before + 1);
    // The whole fix, in one assertion: the replay carries the ORIGINAL id, so
    // the server's `@@unique([chatSessionId, clientMessageId])` dedupes it
    // instead of storing a second copy.
    expect(sends[before]?.id).toBe(messageId);
  });

  it('leaves exactly one message in state — the duplicate bubble is the reported symptom', async () => {
    const { widget } = await withFailedMessage();
    expect(widget.store.getState().messages).toHaveLength(1);

    const button = retryButtons()[0];
    if (button === undefined) throw new Error('no retry button was offered');
    button.click();
    await settle();

    expect(widget.store.getState().messages).toHaveLength(1);
    // ...and therefore exactly one Retry affordance, not one per click.
    expect(shadow().querySelectorAll('.dh-retry')).toHaveLength(1);
  });

  it('does not multiply the message no matter how many times Retry is pressed', async () => {
    const { widget, socket } = await withFailedMessage();

    for (let i = 0; i < 3; i += 1) {
      const button = retryButtons()[0];
      if (button !== undefined) button.click();
      await settle();
      // Fail it again so the affordance comes back for the next press.
      const sends = socket.frames('message.send');
      const last = sends[sends.length - 1];
      if (last !== undefined) socket.reject(last.id, true);
      await settle();
    }

    expect(widget.store.getState().messages).toHaveLength(1);
  });

  it('re-queues the message rather than reporting a failure to the host', async () => {
    const errors: unknown[] = [];
    FakeWebSocket.instances = [];
    document.body.innerHTML = '';
    unmount();

    const widget = mount(config({ onError: (error) => errors.push(error) }));
    await settle();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket');
    socket.open();
    socket.ack();
    await settle();
    await widget.store.client.sendMessage('hello');
    await settle();
    const sent = socket.frames('message.send')[0];
    if (sent === undefined) throw new Error('no send');
    socket.reject(sent.id, true);
    await settle();
    errors.length = 0;

    const button = retryButtons()[0];
    if (button === undefined) throw new Error('no retry button');
    button.click();
    await settle();

    expect(errors).toHaveLength(0);
  });
});

describe('a refusal core is entitled to return', () => {
  it('hands the words back to an empty composer when the id can never go again', async () => {
    const { widget } = await withFailedMessage();
    widget.open();

    // `not-retryable` is what core returns for, among other things, a failure
    // belonging to a session that is no longer the joined one. Branched on the
    // discriminant, never on the message text.
    vi.spyOn(widget.store.client, 'retryMessage').mockResolvedValue({
      status: 'refused',
      reason: 'not-retryable',
    });

    const button = retryButtons()[0];
    if (button === undefined) throw new Error('no retry button');
    button.click();
    await settle();

    const input = query<HTMLTextAreaElement>('.dh-input');
    expect(input.value).toBe('where is my order?');
    expect(shadow().activeElement).toBe(input);
  });

  it('never clobbers something the customer is already typing', async () => {
    const { widget } = await withFailedMessage();
    widget.open();

    const input = query<HTMLTextAreaElement>('.dh-input');
    input.value = 'a different question';

    vi.spyOn(widget.store.client, 'retryMessage').mockResolvedValue({
      status: 'refused',
      reason: 'not-retryable',
    });

    const button = retryButtons()[0];
    if (button === undefined) throw new Error('no retry button');
    button.click();
    await settle();

    expect(input.value).toBe('a different question');
  });

  it('stays quiet on not-found — nothing eligible usually means it already went', async () => {
    const errors: unknown[] = [];
    const { widget } = await withFailedMessage();
    // Re-point the sink at this test's array; the mounted config's sink is a
    // no-op by default.
    const input = query<HTMLTextAreaElement>('.dh-input');

    vi.spyOn(widget.store.client, 'retryMessage').mockResolvedValue({
      status: 'refused',
      reason: 'not-found',
    });

    const button = retryButtons()[0];
    if (button === undefined) throw new Error('no retry button');
    button.click();
    await settle();

    // `not-found` means "already retried, already succeeded, or never failed"
    // — offering the text back would invite a genuine duplicate of a message
    // that may well have landed.
    expect(input.value).toBe('');
    expect(errors).toHaveLength(0);
  });

  it('reports a refusal to the host sink so it is diagnosable', async () => {
    const errors: unknown[] = [];
    FakeWebSocket.instances = [];
    unmount();
    document.body.innerHTML = '';

    const widget = mount(config({ onError: (error) => errors.push(error) }));
    await settle();
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket');
    socket.open();
    socket.ack();
    await settle();
    await widget.store.client.sendMessage('hi');
    await settle();
    const sent = socket.frames('message.send')[0];
    if (sent === undefined) throw new Error('no send');
    socket.reject(sent.id, true);
    await settle();
    errors.length = 0;

    vi.spyOn(widget.store.client, 'retryMessage').mockResolvedValue({
      status: 'refused',
      reason: 'not-retryable',
    });

    const button = retryButtons()[0];
    if (button === undefined) throw new Error('no retry button');
    button.click();
    await settle();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('not-retryable');
  });
});
