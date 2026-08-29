// The published widget configuration, fetched from chat-service.
//
// Until now this package was 100% local: every knob came from a `data-*`
// attribute or a `mount()` argument, and the only `fetch()` in it was the token
// mint. That made the console's "Save" button a lie — a merchant could edit
// their greeting, their pre-chat fields, their offline message, and nothing
// downstream ever read them.
//
// ── Precedence: HOST > REMOTE > built-in default ─────────────────────────
//
// A value the host page stated explicitly always wins. Remote config fills in
// only what the host left unsaid, and the built-in defaults fill what is left.
//
// This is deliberately the OPPOSITE of the React widget, where a successful
// fetch clobbers every field of the props (ChatWidget.tsx merges
// `{ ...config, ...published }`). That direction is wrong for an embedded
// script tag. A host that hardcoded `data-accent="#0f172a"` to match its
// checkout page has made a statement about ITS OWN page that a merchant
// clicking Save in a console tab cannot see and should not be able to
// overrule mid-session. Inverting it also makes the failure mode benign:
// when the fetch fails the widget renders exactly what the host asked for,
// rather than snapping between two different appearances depending on
// whether a network call landed.
//
// The consequence to keep in mind: a field the host sets is permanently
// un-remote-configurable for that host. That is the intended trade — it is
// the host's page.
//
// ── What is NOT read from here ───────────────────────────────────────────
//
// `auth`, `identity`, `apiUrl`, `wsUrl`, `sessionId`, `getToken`, `onError`.
// Credentials and endpoints are the host's to state and are needed BEFORE
// this call can be made at all. There is no `secretKey` field on the
// response type and no field that could carry one, for the same reason
// config.ts has none: a shape with no slot for a credential cannot leak one.

import type { ResolvedConfig, WidgetConfig } from './config.js';

/** One console-defined field on the pre-chat form. */
export interface PreChatField {
  readonly id: string;
  readonly label: string;
  readonly type: 'text' | 'email' | 'phone';
  readonly required: boolean;
}

/** How the post-resolution rating is presented. The backend knows only these two. */
export type CsatStyle = 'stars' | 'emoji';

/**
 * What the widget does when the team is closed.
 *
 * Integers, not strings, because that is what the wire carries
 * (`WidgetOfflineMode` in chat-service's schema). Named here so the rest of
 * this package never compares a bare `2`.
 */
export const OFFLINE_MODE = {
  /** Say we are closed; the composer stays available. */
  SHOW_MESSAGE: 1,
  /** Replace the composer with a leave-a-message form. */
  COLLECT_MESSAGE: 2,
  /** Do not render the launcher at all. */
  HIDE_WIDGET: 3,
} as const;

export type OfflineMode = (typeof OFFLINE_MODE)[keyof typeof OFFLINE_MODE];

/** A published bot flow, projected down to what a widget can act on. */
export interface PublishedFlow {
  readonly id: string;
  readonly name: string;
  /** 1 WELCOME | 2 KEYWORD | 3 PAGE | 4 OFFLINE. */
  readonly trigger: number;
  readonly keywords: readonly string[];
  readonly pagePattern: string;
  /** Left opaque on purpose — step shapes are the console's to evolve. */
  readonly steps: readonly unknown[];
}

/**
 * The published config, after parsing — every field already defaulted, so no
 * consumer re-decides one.
 *
 * Flat rather than mirroring the wire's `appearance`/`behaviour` split: those
 * two are opaque `Record<string, unknown>` blobs on the server, which stores
 * and re-serves whatever the console wrote without a field list of its own.
 * Flattening here is where that untyped soup becomes something typed exactly
 * once.
 */
export interface RemoteConfig {
  readonly enabled: boolean;
  readonly accent: string | undefined;
  readonly title: string | undefined;
  readonly greeting: string | undefined;
  readonly preChatEnabled: boolean;
  readonly preChatFields: readonly PreChatField[];
  readonly csatStyle: CsatStyle;
  readonly offlineMode: OfflineMode;
  readonly offlineMessage: string | undefined;
  readonly fileUploads: boolean;
  /** `null` when the tenant does not follow business hours — NOT "closed". */
  readonly isOpenNow: boolean | null;
  readonly flows: readonly PublishedFlow[];
  readonly botDisplayName: string | undefined;
  readonly publishedVersion: number;
}

/** What a widget renders when the config could not be read at all. */
export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  enabled: true,
  accent: undefined,
  title: undefined,
  greeting: undefined,
  preChatEnabled: false,
  preChatFields: [],
  csatStyle: 'stars',
  offlineMode: OFFLINE_MODE.SHOW_MESSAGE,
  offlineMessage: undefined,
  fileUploads: true,
  // `null`, not `false`. "We could not ask" and "the team is closed" are
  // different facts, and rendering an out-of-hours form because a network call
  // failed would be the worst possible reading of a missing answer.
  isOpenNow: null,
  flows: [],
  botDisplayName: undefined,
  publishedVersion: 0,
};

/** Path is fixed by chat-service; only the origin is the host's to state. */
const CONFIG_PATH = '/chat-services/api/v1/widget/config';

/**
 * How long the widget waits before rendering without published config.
 *
 * A bounded wait is not optional. `WIDGET_ALLOWED_ORIGINS` is fleet-wide
 * rather than per-tenant, so a storefront on an unlisted origin gets a
 * response the browser then refuses to hand us — and an unbounded wait would
 * turn that misconfiguration into a widget that never appears at all. Short
 * enough that a customer clicking the launcher immediately does not sit on a
 * blank panel; long enough that an ordinary cold call lands inside it.
 */
export const CONFIG_TIMEOUT_MS = 2_000;

export interface FetchRemoteConfigOptions {
  readonly apiUrl: string;
  readonly publishableKey: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * Reads the published config, or returns `null` if it could not be read.
 *
 * Never throws and never rejects: every failure class — network, CORS, 401,
 * 429, timeout, malformed body — collapses to `null`, because the caller's
 * response to all of them is identical (render the host's own config) and a
 * widget that throws during boot takes the host's page down with it.
 *
 * `null` is not silent, though. The caller reports it through
 * `config.onError`, which is what makes the degradation VISIBLE rather than a
 * widget that mysteriously ignores the console.
 */
export async function fetchRemoteConfig(
  options: FetchRemoteConfigOptions,
): Promise<RemoteConfig | null> {
  const { apiUrl, publishableKey, signal, timeoutMs = CONFIG_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}${CONFIG_PATH}`, {
      method: 'GET',
      // The key identifies the tenant and grants nothing on its own (§10.1).
      // It is the ONLY credential this request carries, and it goes in a
      // header rather than a query string so it stays out of access logs,
      // Referer headers and browser history.
      headers: { Accept: 'application/json', 'X-Publishable-Key': publishableKey },
      // No cookies. This is a cross-origin public read that authenticates
      // itself; sending the merchant's session along would be both useless
      // and a CSRF surface.
      credentials: 'omit',
      // Deliberately NOT 'no-store'. chat-service serves this with
      // `max-age=30, stale-while-revalidate=300` and a `Vary` on the key, and
      // the browser's HTTP cache is the intended consumer of that. Revalidation
      // by hand is not even possible here: `ETag` is absent from the route's
      // CORS `exposedHeaders`, so cross-origin JS cannot read the tag it would
      // need to send back in `If-None-Match`. Letting the browser do it
      // transparently is both cheaper and the only thing that actually works.
      cache: 'default',
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const body: unknown = await response.json();
    return parseRemoteConfig(body);
  } catch {
    // Includes the CORS case, which surfaces as a TypeError with no detail:
    // the browser refuses to tell a page why a cross-origin read failed, so
    // there is nothing here to distinguish "origin not allowlisted" from
    // "server down". The caller's message says so rather than guessing.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────
//
// Every leaf below is read defensively. `appearance` and `behaviour` are
// opaque blobs the server stores and re-serves without validating their
// contents, and the console writes them by WHOLE-OBJECT REPLACEMENT — so a
// field can be absent entirely because an older console version never wrote
// it. Treat every leaf as possibly-missing and possibly the wrong type.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  // Empty strings become `undefined`, not `''`: the console writes `''` for
  // "not set" on several fields, and an empty accent colour or title must fall
  // through to the default rather than render as blank.
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function bool(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

function isOfflineMode(value: unknown): value is OfflineMode {
  return value === 1 || value === 2 || value === 3;
}

function parsePreChatFields(value: unknown): readonly PreChatField[] {
  if (!Array.isArray(value)) return [];
  const fields: PreChatField[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = str(entry, 'id');
    const label = str(entry, 'label');
    // A field with no id has nowhere to store its answer and a field with no
    // label cannot be asked for. Skip it rather than rendering an unlabelled
    // box the customer cannot interpret.
    if (id === undefined || label === undefined) continue;
    const rawType = entry['type'];
    const type = rawType === 'email' || rawType === 'phone' ? rawType : 'text';
    fields.push({ id, label, type, required: bool(entry, 'required', false) });
  }
  return fields;
}

function parseFlows(value: unknown): readonly PublishedFlow[] {
  if (!Array.isArray(value)) return [];
  const flows: PublishedFlow[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = str(entry, 'id');
    const name = str(entry, 'name');
    const trigger = entry['trigger'];
    if (id === undefined || name === undefined || typeof trigger !== 'number') continue;
    flows.push({
      id,
      name,
      trigger,
      keywords: Array.isArray(entry['keywords'])
        ? entry['keywords'].filter((k): k is string => typeof k === 'string')
        : [],
      pagePattern: str(entry, 'pagePattern') ?? '',
      steps: Array.isArray(entry['steps']) ? entry['steps'] : [],
    });
  }
  return flows;
}

/**
 * Turns a wire body into a {@link RemoteConfig}, or `null` if it is not one.
 *
 * Exported for tests: this is the half of the fetch worth asserting against
 * exhaustively, and it is a pure function of the parsed body.
 */
export function parseRemoteConfig(body: unknown): RemoteConfig | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data)) return null;

  const appearance = isRecord(data['appearance']) ? data['appearance'] : {};
  const behaviour = isRecord(data['behaviour']) ? data['behaviour'] : {};
  const rawOfflineMode = data['offlineMode'];
  const rawCsat = behaviour['csatStyle'];
  const rawIsOpen = data['isOpenNow'];
  const rawVersion = data['publishedVersion'];

  return {
    enabled: bool(data, 'enabled', DEFAULT_REMOTE_CONFIG.enabled),
    accent: str(appearance, 'accent'),
    title: str(appearance, 'title'),
    greeting: str(behaviour, 'greeting'),
    preChatEnabled: bool(behaviour, 'preChatEnabled', false),
    preChatFields: parsePreChatFields(behaviour['preChatFields']),
    csatStyle: rawCsat === 'emoji' || rawCsat === 'stars' ? rawCsat : 'stars',
    offlineMode: isOfflineMode(rawOfflineMode) ? rawOfflineMode : OFFLINE_MODE.SHOW_MESSAGE,
    offlineMessage: str(behaviour, 'offlineMessage'),
    fileUploads: bool(behaviour, 'fileUploads', true),
    // Three-valued and kept that way. `null` means "this tenant does not
    // follow business hours", which is not the same as closed.
    isOpenNow: typeof rawIsOpen === 'boolean' ? rawIsOpen : null,
    flows: parseFlows(data['flows']),
    botDisplayName: str(data, 'botDisplayName'),
    publishedVersion: typeof rawVersion === 'number' ? rawVersion : 0,
  };
}

// ── Merge ─────────────────────────────────────────────────────────────────

/**
 * Fills the gaps in a host-supplied config from published config.
 *
 * Only ever ADDS keys the host omitted — see the precedence note at the top
 * of this file. Returns a new object; the input is not mutated.
 *
 * Runs BEFORE `resolveConfig`, which is what makes "the host did not say" a
 * knowable thing at all: once `resolveConfig` has applied its `??` defaults,
 * a host-chosen `'#1f2937'` and a defaulted `'#1f2937'` are the same value
 * and remote config could no longer tell which fields it is allowed to fill.
 */
export function mergeRemoteConfig(host: WidgetConfig, remote: RemoteConfig | null): WidgetConfig {
  if (remote === null) return host;

  const filled: Record<string, unknown> = { ...host };
  // `exactOptionalPropertyTypes` is on, so a key holding `undefined` is not
  // the same as an absent key — assign conditionally rather than spreading
  // possibly-undefined values in.
  if (host.accent === undefined && remote.accent !== undefined) filled['accent'] = remote.accent;
  if (host.title === undefined && remote.title !== undefined) filled['title'] = remote.title;

  return filled as unknown as WidgetConfig;
}

/**
 * Whether the widget should mount a launcher at all.
 *
 * Two independent off-switches, both remote:
 *   - `enabled: false` — the merchant turned the widget off outright.
 *   - `offlineMode: HIDE_WIDGET` while `isOpenNow === false` — the merchant
 *     chose to disappear outside business hours rather than take messages.
 *
 * `isOpenNow === null` never hides anything: it means the tenant does not
 * follow business hours, so there is no "outside" to be outside of.
 */
export function shouldMount(remote: RemoteConfig): boolean {
  if (!remote.enabled) return false;
  return !(remote.offlineMode === OFFLINE_MODE.HIDE_WIDGET && remote.isOpenNow === false);
}

/**
 * Whether the out-of-hours form replaces the composer.
 *
 * Only `COLLECT_MESSAGE` does. `SHOW_MESSAGE` says we are closed but leaves
 * the composer alone, and `HIDE_WIDGET` never got this far ({@link shouldMount}).
 */
export function shouldCollectOffline(remote: RemoteConfig): boolean {
  return remote.isOpenNow === false && remote.offlineMode === OFFLINE_MODE.COLLECT_MESSAGE;
}

// A KNOWN, DELIBERATE DIVERGENCE FROM THE CONSOLE CONTRACT.
//
// The console specifies COLLECT_MESSAGE as "run the tenant's OFFLINE-trigger
// bot flow, falling back to SHOW_MESSAGE when no published+enabled one
// exists". This widget does not implement the bot-flow step machine at all —
// that is a separate feature — so it renders a built-in offline form and does
// NOT consult `flows` first.
//
// Chosen knowingly rather than by omission. Implementing only the fallback
// half would leave a merchant who set COLLECT_MESSAGE without authoring an
// OFFLINE flow with no form at all, which is strictly worse than the built-in
// one: it collects the same name/contact/message an offline flow would. The
// payload carries no flag saying the fallback happened, so nothing here could
// distinguish the two cases even if it wanted to.
//
// What it costs: a merchant who DID author an OFFLINE flow gets the generic
// form rather than their scripted one. Closing that needs the step machine.
// `PublishedFlow.trigger === 4` is parsed and carried for exactly that.

/** Convenience for the UI layer: is the team closed right now? */
export function isOutOfHours(remote: RemoteConfig): boolean {
  return remote.isOpenNow === false;
}

/** Narrow view of the resolved config the UI needs. Keeps imports one-way. */
export type ConfiguredWidget = ResolvedConfig & { readonly remote: RemoteConfig };
