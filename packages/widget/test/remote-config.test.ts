// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CONFIG_TIMEOUT_MS,
  DEFAULT_REMOTE_CONFIG,
  OFFLINE_MODE,
  fetchRemoteConfig,
  isOutOfHours,
  mergeRemoteConfig,
  parseRemoteConfig,
  shouldCollectOffline,
  shouldMount,
} from '../src/remote-config.js';
import type { RemoteConfig } from '../src/remote-config.js';
import type { WidgetConfig } from '../src/config.js';

// Assembled at runtime, never a contiguous literal — see auth.test.ts.
const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

/** A full, realistic body exactly as chat-service serializes it. */
function body(overrides: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    data: {
      enabled: true,
      appearance: {
        accent: '#7C3AED',
        title: 'Dhaam Support',
        theme: 'dark',
        position: 'bottom-left',
        offsetX: 24,
        offsetY: 32,
        launcher: 'tab',
        launcherLabel: 'Need help?',
        launcherIcon: { source: 'emoji', library: 'chat', emoji: '👋', imageUrl: '' },
        launcherShadow: { enabled: true, intensity: 70 },
        design: 'hero',
        header: {
          background: 'gradient',
          backgroundColor: '',
          colorSource: 'accent',
          gradientStrength: 80,
          backgroundImageUrl: '',
          imageOverlay: 45,
        },
        cornerRadius: 20,
        fontFamily: 'Inter',
      },
      behaviour: {
        greeting: 'How can we help today?',
        preChatEnabled: true,
        preChatFields: [
          { id: 'p1', label: 'Your name', type: 'text', required: true },
          { id: 'p2', label: 'Email address', type: 'email', required: true },
        ],
        commonQuestions: [
          { id: 'track', label: 'Track my order', prompt: 'Where is my order?' },
          { id: 'refund', label: 'Refund question', prompt: 'I have a question about a refund.' },
        ],
        csatStyle: 'emoji',
        offlineMessage: "We're closed right now.",
        fileUploads: true,
      },
      offlineMode: OFFLINE_MODE.COLLECT_MESSAGE,
      isOpenNow: false,
      flows: [
        { id: 'flow-1', name: 'Welcome', trigger: 1, keywords: ['refund'], pagePattern: '/cart', steps: [{ id: 's1' }] },
      ],
      botDisplayName: 'Dhaam Bot',
      publishedVersion: 4,
      ...overrides,
    },
  };
}

function hostConfig(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseRemoteConfig — the wire body becomes one typed shape', () => {
  it('reads every field off a full body', () => {
    const config = parseRemoteConfig(body());
    expect(config).not.toBeNull();
    expect(config).toMatchObject({
      enabled: true,
      accent: '#7C3AED',
      title: 'Dhaam Support',
      theme: 'dark',
      position: 'bottom-left',
      offsetX: 24,
      offsetY: 32,
      launcher: 'tab',
      launcherLabel: 'Need help?',
      cornerRadius: 20,
      fontFamily: 'Inter',
      greeting: 'How can we help today?',
      preChatEnabled: true,
      csatStyle: 'emoji',
      offlineMode: OFFLINE_MODE.COLLECT_MESSAGE,
      offlineMessage: "We're closed right now.",
      fileUploads: true,
      isOpenNow: false,
      botDisplayName: 'Dhaam Bot',
      publishedVersion: 4,
    });
    expect(config?.preChatFields).toEqual([
      { id: 'p1', label: 'Your name', type: 'text', required: true },
      { id: 'p2', label: 'Email address', type: 'email', required: true },
    ]);
    expect(config?.commonQuestions).toEqual([
      { id: 'track', label: 'Track my order', prompt: 'Where is my order?' },
      { id: 'refund', label: 'Refund question', prompt: 'I have a question about a refund.' },
    ]);
    // No `imageUrl`: the console keeps the unused branches populated, and it
    // writes `''` for the one that was never filled in — which `str()` reads
    // as unset, so it never reaches the partial and never stamps over a
    // default. The branches that DO hold something all survive.
    expect(config?.launcherIcon).toEqual({ source: 'emoji', library: 'chat', emoji: '👋' });
    expect(config?.launcherShadow).toEqual({ enabled: true, intensity: 70 });
    expect(config?.design).toBe('hero');
    // Again no empty strings: `backgroundColor: ''` is the console's way of
    // saying "follow colorSource", which is an ABSENCE rather than a colour.
    expect(config?.header).toEqual({
      background: 'gradient',
      colorSource: 'accent',
      gradientStrength: 80,
      imageOverlay: 45,
    });
    expect(config?.flows[0]).toMatchObject({ id: 'flow-1', trigger: 1, keywords: ['refund'], pagePattern: '/cart' });
  });

  // `{}`, not a defaulted object: it is the one-level-down equivalent of the
  // scalars' `undefined`, and the merge needs to be able to tell "the merchant
  // said nothing" from "the merchant chose the value we would have defaulted to".
  it.each([
    ['absent', undefined],
    ['not an object', 'nope'],
    ['an array', []],
  ])('reads a launcherIcon that is %s as an empty partial', (_label, launcherIcon) => {
    const config = parseRemoteConfig({ data: { appearance: { launcherIcon }, behaviour: {} } });
    expect(config?.launcherIcon).toEqual({});
  });

  it('keeps only the launcherIcon fields it could actually read', () => {
    const config = parseRemoteConfig({
      data: {
        appearance: { launcherIcon: { source: 'sticker', library: 'support', emoji: 42 } },
        behaviour: {},
      },
    });
    // A source nobody ships and a non-string emoji are both dropped; the
    // library id survives, and no key is left present-holding-undefined —
    // which under exactOptionalPropertyTypes would stamp over a default.
    expect(config?.launcherIcon).toEqual({ library: 'support' });
  });

  it('keeps only the header fields it could actually read', () => {
    const config = parseRemoteConfig({
      data: {
        appearance: {
          header: {
            background: 'plaid',
            colorSource: 'platform',
            gradientStrength: 'lots',
            imageOverlay: 0,
          },
        },
        behaviour: {},
      },
    });
    // A background kind nobody ships and a non-numeric strength are dropped; a
    // ZERO overlay survives, because zero is a choice and not an absence.
    expect(config?.header).toEqual({ colorSource: 'platform', imageOverlay: 0 });
  });

  it('keeps a launcherShadow the merchant switched OFF, rather than reading it as unset', () => {
    const config = parseRemoteConfig({
      data: { appearance: { launcherShadow: { enabled: false } }, behaviour: {} },
    });
    expect(config?.launcherShadow).toEqual({ enabled: false });
  });

  it.each([
    ['not an object', 42],
    ['null', null],
    ['an array', []],
    ['missing data', { success: true }],
    ['data that is not an object', { success: true, data: 'nope' }],
  ])('returns null for a body that is %s', (_label, input) => {
    expect(parseRemoteConfig(input)).toBeNull();
  });

  // The server stores appearance/behaviour as opaque blobs written by
  // whole-object replacement, so any leaf can simply be missing.
  it('defaults every leaf when appearance and behaviour are empty', () => {
    const config = parseRemoteConfig({ data: { appearance: {}, behaviour: {} } });
    expect(config).toEqual({
      ...DEFAULT_REMOTE_CONFIG,
      // `enabled` defaults true and there is no publishedVersion to read.
      publishedVersion: 0,
    });
  });

  it('survives appearance/behaviour being the wrong type entirely', () => {
    const config = parseRemoteConfig({ data: { appearance: 'nope', behaviour: 7, enabled: true } });
    expect(config?.accent).toBeUndefined();
    expect(config?.csatStyle).toBe('stars');
  });

  it('treats an empty-string accent or title as unset, not as a blank value', () => {
    const config = parseRemoteConfig({ data: { appearance: { accent: '   ', title: '' }, behaviour: {} } });
    expect(config?.accent).toBeUndefined();
    expect(config?.title).toBeUndefined();
  });

  it.each(['light', 'dark', 'auto'])('reads theme %s off appearance', (theme) => {
    expect(parseRemoteConfig({ data: { appearance: { theme }, behaviour: {} } })?.theme).toBe(theme);
  });

  // `undefined`, not `'auto'`. The three-way distinction matters exactly once
  // — in mergeRemoteConfig, which may only fill a field the host left unsaid —
  // and collapsing an unrecognised value to a real one here would hand the
  // merge a choice nobody made.
  it.each([
    ['an unknown scheme', 'sepia'],
    ['the wrong type', 1],
    ['absent', undefined],
  ])('leaves theme unset when it is %s', (_label, theme) => {
    expect(parseRemoteConfig({ data: { appearance: { theme }, behaviour: {} } })?.theme).toBeUndefined();
  });

  // NaN and Infinity are the two that matter: both survive `typeof x ===
  // 'number'`, both survive String(), and both reach a stylesheet as a
  // declaration the engine drops.
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '20'],
    ['absent', undefined],
  ])('leaves cornerRadius unset when it is %s', (_label, cornerRadius) => {
    const config = parseRemoteConfig({ data: { appearance: { cornerRadius }, behaviour: {} } });
    expect(config?.cornerRadius).toBeUndefined();
  });

  it('keeps a zero corner radius, which is a real choice and not "unset"', () => {
    const config = parseRemoteConfig({ data: { appearance: { cornerRadius: 0 }, behaviour: {} } });
    expect(config?.cornerRadius).toBe(0);
  });

  it.each([
    ['a corner nobody ships', 'top-left'],
    ['the wrong type', true],
    ['absent', undefined],
  ])('leaves position unset when it is %s', (_label, position) => {
    const config = parseRemoteConfig({ data: { appearance: { position }, behaviour: {} } });
    expect(config?.position).toBeUndefined();
  });

  it.each([
    ['a shape nobody ships', 'pill'],
    ['the wrong type', 2],
    ['absent', undefined],
  ])('leaves the launcher shape unset when it is %s', (_label, launcher) => {
    const config = parseRemoteConfig({ data: { appearance: { launcher }, behaviour: {} } });
    expect(config?.launcher).toBeUndefined();
  });

  it('keeps a zero offset, which pins the launcher flush to the edge', () => {
    const config = parseRemoteConfig({
      data: { appearance: { offsetX: 0, offsetY: 0 }, behaviour: {} },
    });
    expect(config?.offsetX).toBe(0);
    expect(config?.offsetY).toBe(0);
  });

  it('reads fontFamily as the console NAME, leaving the stack to the renderer', () => {
    const config = parseRemoteConfig({ data: { appearance: { fontFamily: 'Georgia' }, behaviour: {} } });
    expect(config?.fontFamily).toBe('Georgia');
  });

  it.each([
    ['an unknown string', 'thumbs'],
    ['a number', 3],
    ['absent', undefined],
  ])('falls back to stars when csatStyle is %s', (_label, csatStyle) => {
    const config = parseRemoteConfig({ data: { appearance: {}, behaviour: { csatStyle } } });
    expect(config?.csatStyle).toBe('stars');
  });

  it.each([
    ['0', 0],
    ['4', 4],
    ['a string', '2'],
    ['absent', undefined],
  ])('falls back to SHOW_MESSAGE when offlineMode is %s', (_label, offlineMode) => {
    const config = parseRemoteConfig({ data: { appearance: {}, behaviour: {}, offlineMode } });
    expect(config?.offlineMode).toBe(OFFLINE_MODE.SHOW_MESSAGE);
  });

  // The whole point of the three-valued field.
  it.each([
    ['true', true, true],
    ['false', false, false],
    ['null', null, null],
    ['absent', undefined, null],
    ['a string', 'yes', null],
  ])('maps isOpenNow %s to %s', (_label, input, expected) => {
    const config = parseRemoteConfig({ data: { appearance: {}, behaviour: {}, isOpenNow: input } });
    expect(config?.isOpenNow).toBe(expected);
  });

  it('drops pre-chat fields that have no id or no label rather than rendering them', () => {
    const config = parseRemoteConfig({
      data: {
        appearance: {},
        behaviour: {
          preChatFields: [
            { id: 'ok', label: 'Name', type: 'text', required: true },
            { label: 'No id' },
            { id: 'no-label' },
            'not an object',
            { id: 'weird', label: 'Weird type', type: 'colour' },
          ],
        },
      },
    });
    expect(config?.preChatFields).toEqual([
      { id: 'ok', label: 'Name', type: 'text', required: true },
      // An unrecognised type degrades to text rather than dropping the field.
      { id: 'weird', label: 'Weird type', type: 'text', required: false },
    ]);
  });

  it('drops common questions that have no id, label or prompt rather than rendering them broken', () => {
    const config = parseRemoteConfig({
      data: {
        appearance: {},
        behaviour: {
          commonQuestions: [
            { id: 'ok', label: 'Track my order', prompt: 'Where is my order?' },
            { label: 'No id', prompt: 'x' },
            { id: 'no-label', prompt: 'x' },
            { id: 'no-prompt', label: 'No prompt' },
            'not an object',
          ],
        },
      },
    });
    expect(config?.commonQuestions).toEqual([
      { id: 'ok', label: 'Track my order', prompt: 'Where is my order?' },
    ]);
  });

  it('defaults commonQuestions to an empty array when absent, rather than a built-in list', () => {
    const config = parseRemoteConfig({ data: { appearance: {}, behaviour: {} } });
    expect(config?.commonQuestions).toEqual([]);
  });

  it('drops flows missing an id, name or numeric trigger', () => {
    const config = parseRemoteConfig({
      data: {
        appearance: {},
        behaviour: {},
        flows: [
          { id: 'a', name: 'A', trigger: 1 },
          { id: 'b', name: 'B' },
          { name: 'C', trigger: 2 },
        ],
      },
    });
    expect(config?.flows.map((f) => f.id)).toEqual(['a']);
    expect(config?.flows[0]).toMatchObject({ keywords: [], pagePattern: '', steps: [] });
  });
});

describe('fetchRemoteConfig — every failure class collapses to null', () => {
  it('sends the publishable key as a header, never in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body() });
    vi.stubGlobal('fetch', fetchMock);

    await fetchRemoteConfig({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chat.example.com/chat-services/api/v1/widget/config');
    expect(url).not.toContain(PUBLISHABLE);
    expect((init.headers as Record<string, string>)['X-Publishable-Key']).toBe(PUBLISHABLE);
    // No cookies on a cross-origin public read.
    expect(init.credentials).toBe('omit');
  });

  it("lets the browser's HTTP cache do the revalidating", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body() });
    vi.stubGlobal('fetch', fetchMock);

    await fetchRemoteConfig({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE });

    // Not 'no-store': the route ships max-age=30 + stale-while-revalidate, and
    // ETag is not in its CORS exposedHeaders, so hand-rolled revalidation is
    // impossible cross-origin anyway.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.cache).toBe('default');
  });

  it('strips a trailing slash off apiUrl rather than doubling it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body() });
    vi.stubGlobal('fetch', fetchMock);

    await fetchRemoteConfig({ apiUrl: 'https://chat.example.com//', publishableKey: PUBLISHABLE });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://chat.example.com/chat-services/api/v1/widget/config');
  });

  it.each([
    ['a 401 from an unknown key', { ok: false, status: 401 }],
    ['a 429 from the throttle', { ok: false, status: 429 }],
    ['a 500', { ok: false, status: 500 }],
  ])('returns null on %s', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect(
      await fetchRemoteConfig({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE }),
    ).toBeNull();
  });

  // The operational caveat that matters most: WIDGET_ALLOWED_ORIGINS is
  // fleet-wide, so an unlisted storefront gets a response the browser refuses
  // to hand us. It arrives as a bare TypeError with no detail.
  it('returns null when CORS blocks the read, rather than throwing into the host page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(
      fetchRemoteConfig({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE }),
    ).resolves.toBeNull();
  });

  it('returns null when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    expect(
      await fetchRemoteConfig({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE }),
    ).toBeNull();
  });

  it('gives up after the timeout instead of hanging the widget forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );

    const pending = fetchRemoteConfig({ apiUrl: 'https://chat.example.com', publishableKey: PUBLISHABLE });
    await vi.advanceTimersByTimeAsync(CONFIG_TIMEOUT_MS + 1);
    await expect(pending).resolves.toBeNull();
  });

  it('honours a caller-supplied abort signal', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );

    const pending = fetchRemoteConfig({
      apiUrl: 'https://chat.example.com',
      publishableKey: PUBLISHABLE,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });
});

describe('mergeRemoteConfig — the host always wins', () => {
  const remote: RemoteConfig = {
    ...DEFAULT_REMOTE_CONFIG,
    accent: '#7C3AED',
    title: 'Remote title',
    theme: 'dark',
  };

  it('fills fields the host left unsaid', () => {
    const merged = mergeRemoteConfig(hostConfig(), remote);
    expect(merged.accent).toBe('#7C3AED');
    expect(merged.title).toBe('Remote title');
    expect(merged.theme).toBe('dark');
  });

  // The rule the whole precedence decision exists for: a host that hardcoded
  // a colour to match its checkout page must not have it yanked by a console
  // save it cannot see.
  it('never overwrites a value the host stated explicitly', () => {
    const merged = mergeRemoteConfig(
      hostConfig({ accent: '#0f172a', title: 'Host title', theme: 'light' }),
      remote,
    );
    expect(merged.accent).toBe('#0f172a');
    expect(merged.title).toBe('Host title');
    expect(merged.theme).toBe('light');
  });

  // The reason RemoteConfig's appearance fields are `T | undefined` rather
  // than pre-defaulted: a publish that says nothing must leave the key ABSENT,
  // so `resolveConfig`'s own default still applies rather than a value the
  // merge invented.
  it('adds no key at all for a field the publish left unset', () => {
    const merged = mergeRemoteConfig(hostConfig(), DEFAULT_REMOTE_CONFIG) as unknown as Record<
      string,
      unknown
    >;
    expect('theme' in merged).toBe(false);
    expect('accent' in merged).toBe(false);
    expect('launcherIcon' in merged).toBe(false);
  });

  // Precedence is per FIELD even inside the objects the console writes as
  // wholes: a host that named an emoji has said nothing about the library
  // glyph sitting behind it.
  it('overlays the objects key by key rather than replacing them wholesale', () => {
    const merged = mergeRemoteConfig(hostConfig({ launcherIcon: { source: 'emoji', emoji: '👋' } }), {
      ...DEFAULT_REMOTE_CONFIG,
      launcherIcon: { source: 'library', library: 'support', emoji: '🛟' },
    });
    expect(merged.launcherIcon).toEqual({ source: 'emoji', emoji: '👋', library: 'support' });
  });

  it('returns the host config untouched when there is no remote config', () => {
    const host = hostConfig({ accent: '#0f172a' });
    expect(mergeRemoteConfig(host, null)).toBe(host);
  });

  it('never introduces a credential-shaped field', () => {
    const merged = mergeRemoteConfig(hostConfig(), remote) as unknown as Record<string, unknown>;
    expect(Object.keys(merged)).not.toContain('secretKey');
    expect(merged['auth']).toEqual({ publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' });
  });
});

describe('mount and offline gating', () => {
  const at = (overrides: Partial<RemoteConfig>): RemoteConfig => ({ ...DEFAULT_REMOTE_CONFIG, ...overrides });

  it('does not mount when the merchant disabled the widget', () => {
    expect(shouldMount(at({ enabled: false }))).toBe(false);
  });

  it('does not mount when HIDE_WIDGET and the team is closed', () => {
    expect(shouldMount(at({ offlineMode: OFFLINE_MODE.HIDE_WIDGET, isOpenNow: false }))).toBe(false);
  });

  it('still mounts under HIDE_WIDGET while the team is open', () => {
    expect(shouldMount(at({ offlineMode: OFFLINE_MODE.HIDE_WIDGET, isOpenNow: true }))).toBe(true);
  });

  // `null` is "does not follow business hours", so there is no outside to be
  // outside of — it must never hide the widget or open an offline form.
  it('treats an unknown open-state as always open', () => {
    expect(shouldMount(at({ offlineMode: OFFLINE_MODE.HIDE_WIDGET, isOpenNow: null }))).toBe(true);
    expect(shouldCollectOffline(at({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: null }))).toBe(false);
    expect(isOutOfHours(at({ isOpenNow: null }))).toBe(false);
  });

  it('collects an offline message only under COLLECT_MESSAGE while closed', () => {
    expect(shouldCollectOffline(at({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: false }))).toBe(true);
    expect(shouldCollectOffline(at({ offlineMode: OFFLINE_MODE.SHOW_MESSAGE, isOpenNow: false }))).toBe(false);
    expect(shouldCollectOffline(at({ offlineMode: OFFLINE_MODE.COLLECT_MESSAGE, isOpenNow: true }))).toBe(false);
  });

  it('mounts on the defaults a failed fetch leaves behind', () => {
    expect(shouldMount(DEFAULT_REMOTE_CONFIG)).toBe(true);
    expect(shouldCollectOffline(DEFAULT_REMOTE_CONFIG)).toBe(false);
  });
});
