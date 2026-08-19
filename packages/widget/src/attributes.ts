// `data-*` attributes → `WidgetConfig`.
//
// Pure and DOM-free: it takes a plain record, not an element, so the whole
// attribute contract is a table test rather than a browser test — and so the
// secret-key sweep below can be proved without constructing a document.
//
// ── The sweep does not care which attribute it reads ────────────────────
//
// `assertNoSecretKeys` is handed EVERY value, including ones this parser does
// not recognise. That is the point. The realistic accident is not
// `data-publishable-key="dhk_live_…"` — someone doing that at least knew the
// key had a home. It is a developer adding `data-secret-key` or `data-api-key`
// alongside the publishable one because the pair looked symmetrical, and then
// serving it to every visitor. An unknown attribute has to fail exactly as
// hard as a known one, so recognition is not a precondition for refusal.

import { assertNoSecretKeys } from './auth.js';
import { WidgetConfigError, parseMode } from './config.js';
import type { WidgetConfig } from './config.js';

/** A `DOMStringMap`, or anything shaped like one. */
export type AttributeBag = Readonly<Record<string, string | undefined>>;

function optional(bag: AttributeBag, key: string): string | undefined {
  const value = bag[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function required(bag: AttributeBag, key: string, attribute: string): string {
  const value = optional(bag, key);
  if (value === undefined) throw new WidgetConfigError(`${attribute} is required`);
  return value;
}

/**
 * `"false"`, `"0"`, and `"no"` are false; a bare attribute is true.
 *
 * `data-open` with no value parses as the empty string, and HTML convention
 * says a present boolean attribute is true — so an integrator writing
 * `<script … data-open>` gets what they plainly meant, rather than a falsy
 * empty string.
 */
function boolean(bag: AttributeBag, key: string): boolean | undefined {
  const raw = bag[key];
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === '') return true;
  return !['false', '0', 'no', 'off'].includes(value);
}

function side(bag: AttributeBag): 'left' | 'right' | undefined {
  const value = optional(bag, 'side')?.toLowerCase();
  if (value === undefined) return undefined;
  if (value === 'left' || value === 'right') return value;
  throw new WidgetConfigError(`unknown side ${JSON.stringify(value)} — expected left or right`);
}

function font(bag: AttributeBag): 'isolate' | 'inherit' | undefined {
  const value = optional(bag, 'font')?.toLowerCase();
  if (value === undefined) return undefined;
  if (value === 'isolate' || value === 'inherit') return value;
  throw new WidgetConfigError(`unknown font ${JSON.stringify(value)} — expected isolate or inherit`);
}

function breakpoint(bag: AttributeBag): number | undefined {
  const value = optional(bag, 'breakpoint');
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new WidgetConfigError('data-breakpoint must be a positive number of CSS pixels');
  }
  return parsed;
}

/**
 * Builds a config from a script tag's dataset.
 *
 * @throws {SecretKeyInClientError} if ANY attribute value is a secret key.
 * @throws {WidgetConfigError} if a required attribute is missing or a value is not recognised.
 */
export function configFromAttributes(bag: AttributeBag): WidgetConfig {
  // First, before a single value is read for its meaning. A secret key must
  // not reach a config object, let alone a socket, even transiently.
  assertNoSecretKeys(
    Object.values(bag).filter((value): value is string => typeof value === 'string'),
  );

  const config: Record<string, unknown> = {
    auth: {
      publishableKey: required(bag, 'publishableKey', 'data-publishable-key'),
      tokenEndpoint: required(bag, 'tokenEndpoint', 'data-token-endpoint'),
    },
    identity: {
      userId: required(bag, 'userId', 'data-user-id'),
      displayName: optional(bag, 'displayName'),
    },
    apiUrl: required(bag, 'apiUrl', 'data-api-url'),
    wsUrl: required(bag, 'wsUrl', 'data-ws-url'),
  };

  // Assigned conditionally rather than as `key: maybeUndefined`, because
  // `exactOptionalPropertyTypes` is on: a present key holding `undefined` is
  // NOT the same as an absent key, and `resolveConfig`'s `??` defaults would
  // still fire but the object would misreport what the host asked for.
  const optionals: Record<string, unknown> = {
    mode: parseMode(bag['mode']),
    side: side(bag),
    font: font(bag),
    sheetBreakpointPx: breakpoint(bag),
    openOnLoad: boolean(bag, 'open'),
    title: optional(bag, 'title'),
    accent: optional(bag, 'accent'),
    sessionId: optional(bag, 'sessionId'),
  };
  for (const [key, value] of Object.entries(optionals)) {
    if (value !== undefined) config[key] = value;
  }

  return config as unknown as WidgetConfig;
}
