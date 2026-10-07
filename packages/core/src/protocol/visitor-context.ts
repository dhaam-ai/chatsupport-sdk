// The visitor's page context (chatbot-workflows.md §9.1) — normalised on the
// way OUT.
//
// The server is strict about this and answers a bad field differently per
// frame: `context.update` fails the whole frame with VALIDATION_FAILED, and a
// bad `hello.context` is dropped whole. A host page hands this SDK whatever it
// has to hand (a route name in capitals, a query string that pushed the URL
// past 2 KB, a stray object in `attributes`), and none of that may cost the
// visitor their page flows — let alone their chat. So each field is checked
// against the server's own rule and DROPPED on its own if it fails, and what
// is left is always something the server will accept.
//
// Pure and DOM-free (core's hard invariant). `null` means "not an object at
// all" — the caller ignores the call; `{}` means "an object with nothing
// usable", which as a `context.update` legitimately clears the stored context.

import type { VisitorContext } from './frames.js';

/** Mirrors chat-service-node's `parseVisitorContext` limits (v2/protocol/validate.ts). */
const LABEL = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_URL = 2048;
const MAX_ATTRIBUTES = 20;
const ATTRIBUTE_KEY = /^[A-Za-z0-9_.-]{1,40}$/;
const MAX_ATTRIBUTE_STRING = 200;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_STORE_ID = 80;
/** A position is held to three decimals (about 110 m): enough to rank what is near, and a small move is not a new context. */
const LOCATION_SCALE = 1000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAttributes(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isPlainObject(value)) return undefined;
  const bag: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(value)) {
    if (Object.keys(bag).length === MAX_ATTRIBUTES) break;
    if (!ATTRIBUTE_KEY.test(key)) continue;
    const raw = value[key];
    if (typeof raw === 'boolean') bag[key] = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) bag[key] = raw;
    else if (typeof raw === 'string' && raw.length <= MAX_ATTRIBUTE_STRING) bag[key] = raw;
  }
  // The server insists `currency` is an ISO 4217 code, and refuses the whole
  // bag over one that is not — so a lower-case code is fixed and anything else
  // is dropped alone.
  if ('currency' in bag) {
    const currency = typeof bag['currency'] === 'string' ? bag['currency'].trim().toUpperCase() : '';
    if (CURRENCY.test(currency)) bag['currency'] = currency;
    else delete bag['currency'];
  }
  return Object.keys(bag).length === 0 ? undefined : bag;
}

function idText(value: unknown): string | undefined {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && text.length > 0 && text.length <= MAX_STORE_ID ? text : undefined;
}

function normalizeStore(value: unknown): VisitorContext['store'] | undefined {
  if (!isPlainObject(value)) return undefined;
  const id = idText(value['id']);
  if (id === undefined) return undefined;
  const outletId = idText(value['outletId']);
  return outletId === undefined ? { id } : { id, outletId };
}

/** A `{ lat, lng }` the server will accept (finite, in range), at three decimals; `undefined` for anything else. */
export function normalizeLocation(value: unknown): VisitorContext['location'] | undefined {
  if (!isPlainObject(value)) return undefined;
  const lat = value['lat'];
  const lng = value['lng'];
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat: Math.round(lat * LOCATION_SCALE) / LOCATION_SCALE, lng: Math.round(lng * LOCATION_SCALE) / LOCATION_SCALE };
}

/**
 * `context` with `location` set to the visitor's position -- unless the host already set its own, or there is none to add.
 * A new object; `context` is never changed.
 */
export function withLocation(context: VisitorContext, location: { readonly lat: number; readonly lng: number } | undefined): VisitorContext {
  if (location === undefined || context.location !== undefined) return context;
  const normalized = normalizeLocation(location);
  return normalized === undefined ? context : { ...context, location: normalized };
}

/**
 * The visitor's time zone as an IANA name ("Asia/Kolkata"), read from the runtime, or
 * `undefined` when it can't say. Order dates are shown to the visitor in it. Never throws:
 * a runtime without `Intl`, or one that answers with something the server would not accept
 * as an attribute, simply sends nothing.
 */
export function browserTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `context` with `attributes.timezone` set to `timeZone` — unless the host already set its own,
 * the bag is full, or there is no zone to add. A new object; `context` is never changed.
 */
export function withTimeZone(context: VisitorContext, timeZone: string | undefined): VisitorContext {
  if (timeZone === undefined) return context;
  const attributes = context.attributes ?? {};
  if ('timezone' in attributes || Object.keys(attributes).length >= MAX_ATTRIBUTES) return context;
  return { ...context, attributes: { ...attributes, timezone: timeZone } };
}

export function normalizeVisitorContext(input: unknown): VisitorContext | null {
  if (!isPlainObject(input)) return null;
  const context: VisitorContext = {};

  if (typeof input['label'] === 'string') {
    const label = input['label'].trim().toLowerCase();
    if (LABEL.test(label)) context.label = label;
  }

  const url = input['url'];
  if (typeof url === 'string' && url.length > 0 && url.length <= MAX_URL && (url.startsWith('/') || /^https?:\/\//.test(url))) {
    context.url = url;
  }

  const attributes = normalizeAttributes(input['attributes']);
  if (attributes !== undefined) context.attributes = attributes;

  const store = normalizeStore(input['store']);
  if (store !== undefined) context.store = store;

  const location = normalizeLocation(input['location']);
  if (location !== undefined) context.location = location;

  return context;
}

/**
 * A stable identity for a context, independent of key order. What the client
 * compares to decide whether a `context.update` is worth sending: the contract
 * says "send only when the label or URL actually changed".
 */
export function visitorContextKey(context: VisitorContext): string {
  return JSON.stringify(sortKeys(context));
}

function sortKeys(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}
