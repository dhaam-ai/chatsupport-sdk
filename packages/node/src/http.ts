// The HTTP layer: one place that knows the base path, how credentials become
// headers, and how a failure is shaped.
//
// Structurally parallel to `@dhaam-ccrm/rest`'s `client.ts` and deliberately
// so — but not shared with it, because sharing would mean this package
// depends on one that ships in a browser bundle. The error taxonomy is the
// same shape for the opposite reason: a caller who learned
// `RestApiError` vs `RestTransportError` in one package should meet the same
// distinction here rather than a second vocabulary for the same idea.

import { ChatApiError, ChatTransportError } from './errors.js';

/**
 * Every route on chat-service is mounted under this prefix, and the OpenAPI
 * `servers` block resolves to `{apiUrl}/chat-services/api/v1`.
 *
 * Verified against the running service rather than taken from the document:
 * `src/api/rest/server.ts` registers every route group with
 * `{ prefix: '/chat-services/api/v1' }`. The spec previously resolved to
 * `{apiUrl}/v1`, a path no route served — a defect that shipped green on both
 * sides because neither the spec nor the service tested the other's assumption.
 * Encoded here so a caller supplies an ORIGIN, not a path.
 */
export const BASE_PATH = '/chat-services/api/v1';

/** Returns the headers that authenticate one request. Async because a token may need refreshing. */
export type HeaderProvider = () => Promise<Record<string, string>> | Record<string, string>;

export interface HttpClientOptions {
  /** Origin only — scheme and host, no path, no trailing slash. */
  readonly apiUrl: string;
  /** Supplies the credential headers for each request. */
  readonly authHeaders: HeaderProvider;
  /** Defaults to the global `fetch` (Node 18+). Injectable for tests. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Shape of the API's failure body. Narrowed defensively — this is untrusted input. */
function readErrorBody(body: unknown): { code: string; message: string; retryable: boolean } | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const { code, message, retryable } = error as Record<string, unknown>;
  if (typeof code !== 'string') return null;
  return {
    code,
    message: typeof message === 'string' ? message : code,
    retryable: retryable === true,
  };
}

export class HttpClient {
  readonly #apiUrl: string;
  readonly #authHeaders: HeaderProvider;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: HttpClientOptions) {
    if (typeof options.apiUrl !== 'string' || options.apiUrl === '') {
      throw new Error('apiUrl is required (the origin of your chat-service deployment)');
    }
    // Trailing slash trimmed here rather than documented as the caller's
    // problem: `${origin}/${BASE_PATH}` with both supplying a slash yields a
    // double slash, which some proxies 404 and others silently normalize — a
    // difference that surfaces in exactly one deployment.
    this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.#authHeaders = options.authHeaders;

    const resolved = options.fetch ?? globalThis.fetch;
    if (typeof resolved !== 'function') {
      throw new Error(
        'no fetch implementation available — this package requires Node 18+, or pass options.fetch',
      );
    }
    this.#fetch = resolved.bind(globalThis);
  }

  async request<T>(
    method: string,
    path: string,
    init: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.#apiUrl}${BASE_PATH}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(await this.#authHeaders()),
    };

    let body: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        // Spread rather than `body: undefined`: `exactOptionalPropertyTypes`
        // treats an explicit undefined as distinct from an absent property.
        ...(body === undefined ? {} : { body }),
      });
    } catch (cause) {
      // No server verdict. The cause is HELD, never stringified into a
      // message — `fetch`'s own error text can embed the request URL, and a
      // URL on this service has historically carried a token in its query
      // string (§14).
      throw new ChatTransportError(cause);
    }

    // Safe to surface: a correlation id, generated server-side, that the error
    // body echoes as `error.details.requestId` for support.
    const requestId = response.headers.get('x-request-id') ?? undefined;

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const parsed: unknown = text ? safeJson(text) : null;

    if (!response.ok) {
      const structured = readErrorBody(parsed);
      throw new ChatApiError({
        code: structured?.code ?? `HTTP_${response.status}`,
        // Falls back to the status, never to the raw body. An error body is
        // attacker-influencable and may echo request detail back (§14) — and
        // on this route in particular the server deliberately returns ONE
        // opaque message for every authentication failure, so there is
        // nothing more specific to be had anyway.
        message: structured?.message ?? `request failed with status ${response.status}`,
        status: response.status,
        retryable: structured?.retryable ?? response.status >= 500,
        requestId,
      });
    }

    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
