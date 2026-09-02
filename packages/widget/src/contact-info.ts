// Contact-info enrichment for the console's contact-info panel: the
// watermarked IP, the raw user agent, and a best-effort GPS fix — captured
// ONCE per widget session, as early as possible, and fed into core via
// `ChatClient.setContactInfo()` (packages/core/src/client/types.ts).
//
// ── Why this lives in packages/widget, not packages/core ────────────────────
// Core is framework/environment-agnostic by design (see `ChatClientConfig`'s
// own header on `apiUrl`: "core never reads it... core makes zero HTTP
// calls"). Everything below is a browser API (`fetch`, `navigator.userAgent`,
// `navigator.geolocation`) — exactly the boundary `fetchRemoteConfig` in
// remote-config.ts already draws for the same reason, and this file mirrors
// its shape: bounded timeouts, `AbortController`, and NEVER throwing —
// enrichment that fails collapses to "send nothing", not a widget-boot error.
//
// ── Why this never blocks `connect()` ────────────────────────────────────────
// The product decision behind this feature is explicit: GPS in particular
// must never gate the chat opening, and by extension neither should a slow or
// failed ip-watermark fetch — this is enrichment data, not a precondition.
// `captureContactInfo` therefore returns nothing to await; it fires both
// captures and lets each call `client.setContactInfo()` whenever (if ever) it
// resolves. A value that resolves after the first `connection.hello` has
// already gone out simply rides along on the next one (typically a
// reconnect) — see `ConnectionController.setContactInfo`'s own doc for why
// that is an accepted trade-off rather than a bug to chase.

/** Path is fixed by chat-service; only the origin is the host's to state — same convention as `CONFIG_PATH` (remote-config.ts). */
const IP_WATERMARK_PATH = '/chat-services/api/v1/ip-watermark';

/**
 * Bounded the same way `CONFIG_TIMEOUT_MS` is (remote-config.ts): long enough
 * for an ordinary same-datacenter round trip, short enough that a backend
 * hiccup cannot delay this feature's data by more than a beat. Unlike the
 * config fetch there is no visible UI waiting on this — it purely bounds how
 * long the ip-watermark pair might miss the FIRST `connection.hello`.
 */
export const IP_WATERMARK_TIMEOUT_MS = 2_000;

/**
 * The Geolocation permission prompt and/or GPS fix can legitimately take
 * several seconds — a lot longer than a REST round trip — but it must still
 * be bounded, because "wait indefinitely for a fix that never comes because
 * the visitor never answers the prompt" is exactly the block the product
 * decision rules out. Passed as the API's OWN `timeout` option (below),
 * which is what makes the browser itself give up and call the error
 * callback rather than this module racing a second timer against it.
 */
export const GEOLOCATION_TIMEOUT_MS = 5_000;

export interface IpWatermarkResult {
  readonly ip: string;
  readonly watermark: string;
}

export interface GeoResult {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Fetches `GET /chat-services/api/v1/ip-watermark`, or returns `null`.
 *
 * Never throws: network failure, CORS, a non-2xx status, or a malformed body
 * all collapse to `null` — the caller's response to every one of them is
 * identical (send no `ip`/`ipWatermark` on the hello), exactly as
 * `fetchRemoteConfig` collapses its own failure classes.
 */
export async function fetchIpWatermark(
  apiUrl: string,
  timeoutMs: number = IP_WATERMARK_TIMEOUT_MS,
): Promise<IpWatermarkResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}${IP_WATERMARK_PATH}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // No cookies and no publishable key: this endpoint authenticates
      // nothing and identifies no tenant — it only echoes back the caller's
      // OWN observed address, watermarked. See ip-watermark.routes.ts.
      credentials: 'omit',
      // A fresh watermark every call, deliberately never cached — the server
      // sends `Cache-Control: no-store` for the same reason.
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as Record<string, unknown>)['ip'] !== 'string' ||
      typeof (body as Record<string, unknown>)['watermark'] !== 'string'
    ) {
      return null;
    }

    return { ip: (body as { ip: string }).ip, watermark: (body as { watermark: string }).watermark };
  } catch {
    // Includes the AbortError from the timeout above and any CORS-shaped
    // TypeError — neither is distinguishable from the other by a browser, and
    // neither changes what the caller does next.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Requests the browser's own GPS fix, or resolves `null` — NEVER rejects.
 *
 * Every non-success path (no `navigator.geolocation` at all — a non-browser
 * embed or an insecure origin most browsers refuse the API on; the visitor
 * denies the permission prompt; the fix times out) is folded into the same
 * `null`, because §3's product decision treats them identically: fall back to
 * IP-geolocation server-side, and never retry the prompt from this layer.
 */
export function captureGeolocation(timeoutMs: number = GEOLOCATION_TIMEOUT_MS): Promise<GeoResult | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null), // denied, unavailable, or timed out — all the same outcome here.
      {
        timeout: timeoutMs,
        // A cached fix from the last few minutes is a fine substitute for a
        // fresh one for this feature's purpose (an approximate "where is this
        // visitor" for the console) and returns near-instantly when the OS
        // already has one, which matters far more here than centimetre
        // freshness does.
        maximumAge: 5 * 60 * 1000,
        // Session-create enrichment has no use for last-metre accuracy, and
        // high accuracy mode is what makes mobile GPS fixes slow enough to
        // need this whole timeout in the first place.
        enableHighAccuracy: false,
      },
    );
  });
}

/** The one thing this module needs from `ChatClient` — kept narrow so a test double does not need the whole interface. */
export interface ContactInfoSink {
  setContactInfo(info: {
    readonly ip?: string;
    readonly ipWatermark?: string;
    readonly userAgent?: string;
    readonly geo?: { readonly lat: number; readonly lng: number };
  }): void;
}

/**
 * Kicks off every contact-info capture for this session and feeds each
 * result to `client.setContactInfo()` as (and if) it resolves. Call ONCE, as
 * early as possible — immediately before the widget's first `connect()`, per
 * the product decision that this data is gathered "very early (session
 * start)" — and do not await the returned promise before calling `connect()`:
 * it exists for callers (tests) that want to know when every capture has
 * settled, not to gate anything in production.
 */
export async function captureContactInfo(client: ContactInfoSink, apiUrl: string): Promise<void> {
  // Synchronous and always available in a real browser — sent immediately,
  // well before either async capture below has a chance to resolve.
  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && navigator.userAgent.length > 0) {
    client.setContactInfo({ userAgent: navigator.userAgent });
  }

  // Independent of each other and of the UA above — either, both, or neither
  // may end up contributing to the session that gets created.
  await Promise.all([
    fetchIpWatermark(apiUrl).then((result) => {
      if (result) client.setContactInfo({ ip: result.ip, ipWatermark: result.watermark });
    }),
    captureGeolocation().then((geo) => {
      if (geo) client.setContactInfo({ geo });
    }),
  ]);
}
