// Unwrapping `{ success, data }`.
//
// Every route this package calls replies with that envelope — history
// (`chat.routes.ts:276`), close (`:289-292`), reopen (`:310-313`), upload
// (`upload.routes.ts:166-175`) — while `RestClient.request` returns the parsed
// body verbatim.
//
// ── Why this is per-adapter and not inside RestClient.request ──
//
// The same service deliberately serves several routes WITHOUT the envelope —
// `/tokens`, `/health*`, `/ready`, `/live`, and the metrics route. Unwrapping
// globally would mean carrying a route-exception list inside the HTTP client,
// which puts knowledge of individual endpoints in the one module whose job is
// to know none of them. Each adapter knows its own route, so each adapter
// unwraps its own response.

import { RestApiError } from './errors.js';

interface Envelope {
  readonly success?: unknown;
  readonly data?: unknown;
}

/**
 * Returns `body.data`, or throws if `body` is not a successful envelope.
 *
 * ── What this covers, and what it does not ──
 *
 * The customer-facing routes this package calls, where the whole payload is one
 * object under `data`. That is not the only envelope chat-service uses, and the
 * exported form of this function is not a general client for the service:
 *
 *  - Some routes reply `{success: true, message: '…'}` with no `data` at all
 *    (`agent.routes.ts:175`, `:322`, `:538`). Those throw here. Loud is the
 *    right answer for a caller that expected a payload, but it is not
 *    "supported".
 *  - `GET /agent/queue` replies `{success, data: […], nextCursor, hasMore}`
 *    (`agent.routes.ts:384`) — an ARRAY under `data`, with pagination fields as
 *    SIBLINGS of it. This rejects that shape rather than returning the array
 *    and dropping the cursor, which would silently break paging.
 *
 * A future agent-facing adapter needs its own unwrap, not a looser one here:
 * relaxing this to accept both shapes would mean the strictness the
 * customer-facing routes rely on stops applying to any of them.
 *
 * ── Why this is strict rather than a tolerant pass-through ──
 *
 * Handing the envelope back unchanged when it does not match would type a
 * `{success, data}` object as the payload itself. Nothing would throw: the
 * adapter would read `url` off the envelope, get `undefined`, and core would
 * render an attachment bubble pointing nowhere. A silently wrong bubble is
 * strictly worse to diagnose than a rejected promise, so a mismatch fails
 * loudly here — at the seam that knows what the response should have been.
 *
 * @param context Names the route for the error message. Must be a caller-side
 *   constant: it is the only detail that reaches the message, because response
 *   bodies on this service can carry signed URLs (§14) and must never be
 *   echoed into an error a host application might log.
 */
export function unwrapEnvelope<T>(body: unknown, context: string): T {
  const envelope = body as Envelope | null;

  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    envelope.success !== true ||
    typeof envelope.data !== 'object' ||
    envelope.data === null ||
    // No route this package calls returns an array under `data`. One that did
    // would be as broken for the caller as a missing `data`, so it is rejected
    // rather than passed through as if it were the expected object.
    Array.isArray(envelope.data)
  ) {
    throw new RestApiError({
      code: 'MALFORMED_RESPONSE',
      message: `${context} did not return a { success: true, data } envelope`,
      // The transport succeeded and the server reported no failure — the body
      // simply is not what the route documents. 200 records that honestly.
      status: 200,
      // Retrying cannot change a response shape. This is a contract drift
      // between this package and the service, and it needs a code change.
      retryable: false,
    });
  }

  return envelope.data as T;
}
