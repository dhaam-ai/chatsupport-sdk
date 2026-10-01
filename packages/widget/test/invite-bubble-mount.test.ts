// @vitest-environment jsdom
//
// The invite bubble end to end: appears on a pushed flow.invite, autoOpen
// opens the panel directly instead, accepting reconnects with inviteId on
// the hello, and dismissing (by the bubble's own close button, or
// widget.dismissInvite()) sends flow.inviteDismissed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let ulidCounter = 0;
function ulid(): string {
  const c = ULID_ALPHABET[ulidCounter++ % 32] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${c}${c}`;
}

class AckingSocket {
  static instances: AckingSocket[] = [];
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
  open(): void {
    this.onopen?.();
  }
  push(t: string, d: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, t, id: ulid(), ts: Date.now(), d }) });
  }
  ack(sessionId: string): void {
    this.push('connection.ack', {
      protocolVersion: 1,
      seq: 0,
      session: {
        sessionId,
        status: 'ASSIGNED',
        mode: 'HUMAN',
        participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
        createdAt: new Date().toISOString(),
      },
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

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element?.shadowRoot == null) throw new Error('widget not mounted');
  return element.shadowRoot;
}

const find = <T extends Element>(selector: string): T | null => shadow().querySelector<T>(selector);
const isOpen = (): boolean => find<HTMLElement>('.dh-panel')?.getAttribute('data-open') === 'true';

type Frame = { t: string; d: Record<string, unknown> };
const frames = (type: string): Frame[] =>
  AckingSocket.instances
    .flatMap((s) => s.sent.map((raw) => JSON.parse(raw) as Frame))
    .filter((f) => f.t === type)
    .map(({ t, d }) => ({ t, d }));

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  AckingSocket.instances = [];
  vi.stubGlobal('WebSocket', AckingSocket);
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

async function mountAndConnect(overrides: Partial<WidgetConfig> = {}) {
  const widget = mount(config(overrides));
  await settle();
  AckingSocket.instances[0]!.open();
  AckingSocket.instances[0]!.ack('sess_1');
  await settle();
  return widget;
}

describe('a pushed flow.invite', () => {
  it('shows the bubble with the pushed text', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'Need a hand?' });
    await settle();
    const bubble = find<HTMLElement>('.dh-invite-bubble');
    expect(bubble?.hidden).toBe(false);
    expect(bubble?.textContent).toContain('Need a hand?');
  });

  it('names the widget title as who replied, with its configured avatar', async () => {
    await mountAndConnect({ title: 'Dhaam Support', avatarInitials: 'D' });
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'Need a hand?' });
    await settle();
    const bubble = find<HTMLElement>('.dh-invite-bubble');
    expect(bubble?.querySelector('.dh-invite-name')?.textContent).toBe('Dhaam Support replied');
    expect(bubble?.querySelector('.dh-invite-avatar')?.textContent).toBe('D');
  });

  it('with no avatarInitials configured, shows the name but no avatar', async () => {
    await mountAndConnect({ title: 'Dhaam Support' });
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    const bubble = find<HTMLElement>('.dh-invite-bubble');
    expect(bubble?.querySelector('.dh-invite-name')?.textContent).toBe('Dhaam Support replied');
    expect(bubble?.querySelector('.dh-invite-avatar')).toBeNull();
  });

  it('autoOpen skips the bubble and opens the panel directly', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi', autoOpen: true });
    await settle();
    expect(isOpen()).toBe(true);
    expect(find<HTMLElement>('.dh-invite-bubble')?.hidden).toBe(true);
  });

  it('accepting reconnects with inviteId on the hello and hides the bubble', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    find<HTMLElement>('.dh-invite-text')?.click();
    await settle();
    // Accepting reconnects: the hello goes out once the fresh socket opens.
    AckingSocket.instances[AckingSocket.instances.length - 1]!.open();
    await settle();
    expect(find<HTMLElement>('.dh-invite-bubble')?.hidden).toBe(true);
    const hellos = frames('connection.hello');
    expect(hellos[hellos.length - 1]?.d['inviteId']).toBe('inv_1');
  });

  it('accepting the bubble opens straight onto the conversation, not Home', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    find<HTMLElement>('.dh-invite-text')?.click();
    await settle();
    expect(isOpen()).toBe(true);
    expect(document.querySelector('dh-chat-widget')?.getAttribute('data-screen')).toBe('conversation');
  });

  it('autoOpen also opens straight onto the conversation, not Home', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi', autoOpen: true });
    await settle();
    expect(document.querySelector('dh-chat-widget')?.getAttribute('data-screen')).toBe('conversation');
  });

  it('dismissing via the bubble sends flow.inviteDismissed and hides it', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    find<HTMLElement>('.dh-invite-close')?.click();
    await settle();
    expect(frames('flow.inviteDismissed')).toEqual([{ t: 'flow.inviteDismissed', d: { inviteId: 'inv_1' } }]);
    expect(find<HTMLElement>('.dh-invite-bubble')?.hidden).toBe(true);
  });

  it('widget.dismissInvite() dismisses whichever invite is currently shown', async () => {
    const widget = await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    widget.dismissInvite();
    await settle();
    expect(frames('flow.inviteDismissed')).toEqual([{ t: 'flow.inviteDismissed', d: { inviteId: 'inv_1' } }]);
  });

  it('widget.dismissInvite() is a harmless no-op with nothing showing', async () => {
    const widget = await mountAndConnect();
    expect(() => widget.dismissInvite()).not.toThrow();
    expect(frames('flow.inviteDismissed')).toEqual([]);
  });

  it('a widget destroyed while an invite is showing does not throw on a later frame', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    unmount();
    expect(() => AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_2', text: 'hi' })).not.toThrow();
  });
});

describe('widget.sendEvent', () => {
  it('sends a visitor.event frame', async () => {
    const widget = await mountAndConnect();
    widget.sendEvent('search', { query: 'shoes', results: 4 });
    await settle();
    expect(frames('visitor.event')).toEqual([
      { t: 'visitor.event', d: { name: 'search', props: { query: 'shoes', results: 4 } } },
    ]);
  });

  it('never throws on a bad call', async () => {
    const widget = await mountAndConnect();
    expect(() => widget.sendEvent('not_a_real_event')).not.toThrow();
  });
});
