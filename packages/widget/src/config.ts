// What a host page is allowed to configure, and the one place a script tag's
// `data-*` attributes become that shape.
//
// ── The shape of this type IS the §14 key split ──────────────────────────
//
// There is no `secretKey` field here, and there is no field that could carry
// one by another name. That is deliberate and it is the primary defence: a
// browser bundle cannot send a credential it has no slot for. The runtime
// checks in auth.ts are the second line, for the case someone puts a secret
// in the *publishable* slot by mistake.

import type { IdentityProfile } from '@dhaam-ccrm/core';

import type { PresentationMode } from './ui/presentation.js';

/** How the host tells us who the end user is, without ever holding a secret. */
export interface WidgetAuth {
  /**
   * `dhp_live_…` / `dhp_test_…`. Identifies the tenant and grants nothing on
   * its own (§10.1). Validated through core's `parsePublishableKey`, so a
   * `dhk_` secret throws `SecretKeyInClientError` at boot instead of reaching
   * the wire.
   */
  readonly publishableKey: string;

  /**
   * The HOST APP's own endpoint that mints a short-lived access token. The
   * host's server holds the secret key and this browser never sees it — that
   * is the whole point of the split (§10.3, §14).
   *
   * Same-origin path (`/api/chat-token`) or absolute URL. Called with
   * `credentials: 'same-origin'` so the host's existing session cookie
   * authenticates the user; nothing about the end user's identity is passed
   * from here, because anything this bundle could pass, an attacker could
   * forge.
   */
  readonly tokenEndpoint?: string;

  /**
   * The JS-API alternative to {@link tokenEndpoint}, for a host that already
   * has a token in memory. Exactly the contract core documents for
   * `ChatClientConfig.getToken`, passed straight through.
   *
   * Not reachable from a `data-*` attribute for the obvious reason: an
   * attribute is a string, and turning a host-supplied string into a function
   * is `eval`.
   */
  readonly getToken?: () => Promise<string | { accessToken: string; expiresIn?: number }>;
}

export interface WidgetIdentity {
  /** The end user's participant id, as the host's own backend knows them. */
  readonly userId: string;
  /** Optional display name, used only for the local optimistic echo. */
  readonly displayName?: string;

  /**
   * The LOGGED-IN user's CRM profile. Supplying it — and only supplying it —
   * is what makes the widget upsert that user as a Contact via
   * `POST /identify`. `userId` alone does not and must not, because every
   * guest has one of those too.
   *
   * Omit it for a guest. There is no "empty profile" to pass: the key's
   * ABSENCE is the signal, and client.ts spreads it conditionally so a guest's
   * `ChatClientConfig` carries no identity fields at all rather than carrying
   * them present-and-undefined.
   *
   * Nothing here is validated or logged by this package — `resolveConfig`
   * carries it through untouched and the server owns every rule about it.
   *
   * Not reachable from a `data-*` attribute. See attributes.ts.
   */
  readonly profile?: IdentityProfile;
}

export interface WidgetConfig {
  readonly auth: WidgetAuth;
  readonly identity: WidgetIdentity;

  /** Origin only — `https://chat.example.com`, no path. */
  readonly apiUrl: string;
  /** `wss://chat.example.com`. Core refuses to guess this (§12.7). */
  readonly wsUrl: string;

  /**
   * Which presentation to mount. Defaults to `'auto'`: `bubble` on a pointer-
   * and-space desktop, `sheet` below {@link sheetBreakpointPx}. See
   * ui/presentation.ts for why a third mode exists at all.
   */
  readonly mode?: PresentationMode;

  /** Viewport width at or below which `'auto'` resolves to `'sheet'`. Defaults to 640. */
  readonly sheetBreakpointPx?: number;

  /** Which edge `sidebar` slides in from. Defaults to `'right'`. */
  readonly side?: 'left' | 'right';

  /** Opens the panel as soon as it mounts. Defaults to `false`. */
  readonly openOnLoad?: boolean;

  /** Header title. Defaults to `'Chat with us'`. */
  readonly title?: string;

  /** Accent colour, any CSS colour. Defaults to a neutral slate. */
  readonly accent?: string;

  /**
   * `'isolate'` (default) pins our own font stack so the host page's typography
   * cannot distort the widget; `'inherit'` adopts the host's. See ui/styles.ts
   * — inheritable properties DO cross a shadow boundary, so this is a real
   * choice and not a no-op.
   */
  readonly font?: 'isolate' | 'inherit';

  /** Existing session to join on connect, if the host already knows one. */
  readonly sessionId?: string;

  /** Where widget-internal failures go. Defaults to a namespaced `console.warn`. */
  readonly onError?: (error: unknown) => void;
}

/** Everything resolved — no optionals left for the UI layer to re-default. */
export interface ResolvedConfig extends WidgetConfig {
  readonly mode: PresentationMode;
  readonly sheetBreakpointPx: number;
  readonly side: 'left' | 'right';
  readonly openOnLoad: boolean;
  readonly title: string;
  readonly accent: string;
  readonly font: 'isolate' | 'inherit';
  readonly onError: (error: unknown) => void;
}

export class WidgetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WidgetConfigError';
  }
}

const PRESENTATION_MODES = new Set<string>(['auto', 'bubble', 'sidebar', 'sheet']);

/**
 * `panel`, `side`, and `drawer` all mean `sidebar`.
 *
 * The product brief calls it "panel/sidebar", v1's docs called it a "side
 * tab", and every integrator who types one of those is describing the same
 * thing. Accepting the synonyms costs four map entries; rejecting them costs
 * a support ticket where the widget silently fell back to a bubble.
 */
const MODE_ALIASES: Record<string, PresentationMode> = {
  panel: 'sidebar',
  side: 'sidebar',
  drawer: 'sidebar',
  tab: 'sidebar',
  bottomsheet: 'sheet',
  'bottom-sheet': 'sheet',
};

export function parseMode(raw: string | null | undefined): PresentationMode | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === '') return undefined;
  const aliased = MODE_ALIASES[value];
  if (aliased !== undefined) return aliased;
  if (PRESENTATION_MODES.has(value)) return value as PresentationMode;
  throw new WidgetConfigError(
    `unknown mode ${JSON.stringify(raw)} — expected one of auto, bubble, sidebar, sheet`,
  );
}

/**
 * Where a widget-internal failure goes when the host named no sink.
 *
 * Exported because `mount()` needs it before a `ResolvedConfig` exists: the
 * duplicate-mount path reports and returns without ever resolving a config,
 * and reaching for `config.onError` alone made a duplicate SCRIPT TAG — the
 * exact case the guard exists for — completely silent, because an
 * attribute-built config has no `onError` to reach.
 */
export function defaultOnError(error: unknown): void {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn('[@dhaam-ccrm/widget]', error);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    // The field NAME, never the value: this function guards `publishableKey`
    // among others, so echoing the input here would be the credential-leak
    // path core/auth/keys.ts exists to close.
    throw new WidgetConfigError(`${field} is required`);
  }
  return value.trim();
}

/** Fills every default so the UI layer never re-decides one. */
export function resolveConfig(config: WidgetConfig): ResolvedConfig {
  const apiUrl = requireString(config.apiUrl, 'apiUrl').replace(/\/+$/, '');
  const wsUrl = requireString(config.wsUrl, 'wsUrl').replace(/\/+$/, '');
  const userId = requireString(config.identity?.userId, 'identity.userId');
  requireString(config.auth?.publishableKey, 'auth.publishableKey');

  if (config.auth.tokenEndpoint === undefined && config.auth.getToken === undefined) {
    throw new WidgetConfigError(
      'auth needs either a tokenEndpoint (data-token-endpoint) or a getToken function — ' +
        'the browser is never given a secret key, so a token has to come from your own backend',
    );
  }

  const sheetBreakpointPx = config.sheetBreakpointPx ?? 640;
  if (!Number.isFinite(sheetBreakpointPx) || sheetBreakpointPx <= 0) {
    throw new WidgetConfigError('sheetBreakpointPx must be a positive number');
  }

  return {
    ...config,
    apiUrl,
    wsUrl,
    identity: { ...config.identity, userId },
    mode: config.mode ?? 'auto',
    sheetBreakpointPx,
    side: config.side ?? 'right',
    openOnLoad: config.openOnLoad ?? false,
    title: config.title ?? 'Chat with us',
    accent: config.accent ?? '#1f2937',
    font: config.font ?? 'isolate',
    onError: config.onError ?? defaultOnError,
  };
}
