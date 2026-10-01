// @vitest-environment jsdom
//
// `DhaamChat.sendEvent`/`.dismissInvite` — the script-tag form.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWidget, mount, unmount } from '../src/index.js';
import type { DhaamChatGlobal } from '../src/embed.js';
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
  open(): void {
    this.onopen?.();
  }
  ack(sessionId: string): void {
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

function config(): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadEmbed(): Promise<DhaamChatGlobal> {
  vi.resetModules();
  await import('../src/embed.js');
  const api = (window as unknown as Record<string, unknown>)['DhaamChat'];
  if (api === undefined) throw new Error('DhaamChat was not installed');
  return api as DhaamChatGlobal;
}

async function connect(): Promise<FakeWebSocket> {
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack('sess_1');
  await settle();
  return socket;
}

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
  delete (window as unknown as Record<string, unknown>)['DhaamChat'];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

type Frame = { t: string; d: Record<string, unknown> };
const sentFrames = (type: string): Frame[] =>
  FakeWebSocket.instances
    .flatMap((s) => s.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>))
    .filter((f) => f.t === type)
    .map((f) => ({ t: f.t as string, d: f.d as Record<string, unknown> }));

describe('DhaamChat.sendEvent', () => {
  it('is installed on the global and forwards to the mounted widget', async () => {
    const api = await loadEmbed();
    expect(typeof api.sendEvent).toBe('function');
    api.mount(config());
    await connect();
    api.sendEvent('exit_intent', {});
    await settle();
    expect(sentFrames('visitor.event')).toEqual([{ t: 'visitor.event', d: { name: 'exit_intent', props: {} } }]);
  });

  it('is a harmless no-op with nothing mounted', async () => {
    const api = await loadEmbed();
    expect(() => api.sendEvent('exit_intent', {})).not.toThrow();
  });
});

describe('DhaamChat.dismissInvite', () => {
  it('is a harmless no-op with nothing mounted', async () => {
    const api = await loadEmbed();
    expect(() => api.dismissInvite()).not.toThrow();
  });

  it('forwards to the mounted widget', async () => {
    const api = await loadEmbed();
    api.mount(config());
    const socket = await connect();
    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'flow.invite',
        id: ulid(),
        ts: Date.now(),
        d: { inviteId: 'inv_1', text: 'hi' },
      }),
    });
    await settle();
    api.dismissInvite();
    await settle();
    expect(sentFrames('flow.inviteDismissed')).toEqual([{ t: 'flow.inviteDismissed', d: { inviteId: 'inv_1' } }]);
  });
});
