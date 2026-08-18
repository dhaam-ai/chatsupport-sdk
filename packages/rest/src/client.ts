// The HTTP layer: one place that knows the base path, the two credentials, and
// how a failure is shaped.
//
// This package exists because `@dhaam-ccrm/core` deliberately does not do HTTP
// (PRD §4). Core defines the seams — `MessageHistorySource`,
// `AttachmentUploader`, `SessionActions` — and something outside it implements
// them. Keeping that here is what lets core hold its zero-dependency, no-DOM
// invariants, and it is also why the base-path defect (see `BASE_PATH`) was
// fixable in one line instead of in core's public config.

import { RestApiError, RestTransportError } from './errors.js';

/**
 * Every route on chat-service is mounted under this prefix
 * (`src/api/rest/server.ts`), and the v2 WebSocket sits at
 * `/chat-services/v2/ws` for the same reason.
 *
 * The OpenAPI `servers` block originally resolved to `{apiUrl}/v1`, which would
 * have made every generated client — and this adapter — request a path the
 * service does not serve. Corrected in the spec; encoded here so a caller
 * supplies an origin, not a path.
 */
export const BASE_PATH = '/chat-services/api/v1';

export interface RestClientOptions {
  /** Origin only — scheme and host, no path, no trailing slash. */
  readonly apiUrl: string;

  /** `dhpk_live_…` / `dhpk_test_…`. Identifies the tenant; grants nothing alone (§10.1). */
  readonly publishableKey: string;

  /**
   * Returns the current access token. Called per request rather than captured
   * once, so a token refreshed mid-session is picked up without rebuilding the
   * adapter — core owns refresh, and this must not hold a stale copy.
   */
  readonly getAccessToken: () => Promise<string> | string;

  /** Defaults to the global `fetch` (Node 18+ and every browser). Injectable for tests. */
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

export class RestClient {
  readonly #apiUrl: string;
  readonly #publishableKey: string;
  readonly #getAccessToken: () => Promise<string> | string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: RestClientOptions) {
    if (!options.apiUrl) throw new Error('apiUrl is required');
    if (!options.publishableKey) throw new Error('publishableKey is required');

    // Trailing slash trimmed here rather than documented as the caller's
    // problem: `${origin}/${BASE_PATH}` with both supplying a slash yields a
    // double slash, which some proxies 404 and others silently normalize —
    // a difference that shows up only in one deployment.
    this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.#publishableKey = options.publishableKey;
    this.#getAccessToken = options.getAccessToken;

    const resolved = options.fetch ?? globalThis.fetch;
    if (typeof resolved !== 'function') {
      throw new Error('no fetch implementation available — pass options.fetch');
    }
    // Bound so a browser `fetch` is not called with the wrong receiver.
    this.#fetch = resolved.bind(globalThis);
  }

  /** Both credentials, on every request (OpenAPI `securitySchemes`). */
  async #authHeaders(): Promise<Record<string, string>> {
    const token = await this.#getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'X-Publishable-Key': this.#publishableKey,
    };
  }

  async request<T>(
    method: string,
    path: string,
    init: { query?: Record<string, string | number | undefined>; body?: unknown; formData?: FormData } = {},
  ): Promise<T> {
    const url = new URL(`${this.#apiUrl}${BASE_PATH}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = await this.#authHeaders();
    let body: BodyInit | undefined;
    if (init.formData) {
      // Content-Type deliberately unset — the runtime must add the multipart
      // boundary, and setting it by hand produces a body the server cannot parse.
      body = init.formData;
    } else if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }

    let response: Response;
    try {
      // Spread rather than `body: undefined`: `exactOptionalPropertyTypes` treats
      // an explicit undefined as distinct from an absent property, and a GET
      // with a present-but-undefined body is rejected by the type.
      response = await this.#fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    } catch (cause) {
      // No server verdict — see RestTransportError for why this is a distinct type.
      throw new RestTransportError(cause);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const parsed: unknown = text ? safeJson(text) : null;

    if (!response.ok) {
      const structured = readErrorBody(parsed);
      throw new RestApiError({
        code: structured?.code ?? `HTTP_${response.status}`,
        // Falls back to the status, never to the raw body: an error body is
        // attacker-influencable and may echo request detail (§14).
        message: structured?.message ?? `request failed with status ${response.status}`,
        status: response.status,
        retryable: structured?.retryable ?? response.status >= 500,
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
