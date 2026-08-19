// Minimal REST client for the two message-related endpoints core needs —
// task T11's REST leg (§6.3's `loadOlderMessages`, `sendAttachment`). Uses
// the global `fetch`/`FormData`, not a library — available in every
// browser and Node 18+, matching core's compatibility target (PRD §4).
//
// Auth: mirrors openapi/chat-api.yaml's documented scheme
// (`Authorization: Bearer <accessToken>` + `X-Publishable-Key`) for an
// authenticated caller. Gap A amendment (same spirit as the T1 wire-protocol
// change for guest `connection.hello` — see PLAN-v2-core-adoption.md): a
// guest caller has no access token at all, so this client sends
// `X-Guest-Id` instead of `Authorization` in that case. openapi.yaml itself
// doesn't document this header yet — that amendment is still owed as a
// follow-up (this is the client-side half only).

import type { AttachmentMetadata, CloseReason } from '../protocol/index.js';
import type { ChatMessage, ChatSession } from '../state/index.js';

export interface RestAuth {
  token?: string;
  guestId?: string;
}

export interface RestClientOptions {
  /** Base URL, e.g. `https://api.example.com` — no trailing slash required. */
  apiUrl: string;
  publishableKey: string;
  /** Injectable for tests / non-global-fetch environments. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export interface MessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
}

export class RestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RestError';
    this.status = status;
  }
}

function authHeaders(auth: RestAuth, publishableKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Publishable-Key': publishableKey };
  if (auth.token) {
    headers['Authorization'] = `Bearer ${auth.token}`;
  } else if (auth.guestId) {
    headers['X-Guest-Id'] = auth.guestId;
  }
  return headers;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'message' in body && typeof (body as { message: unknown }).message === 'string') {
      return (body as { message: string }).message;
    }
  } catch {
    // fall through to the generic message below
  }
  return `Request failed with status ${response.status}`;
}

export class RestClient {
  readonly #apiUrl: string;
  readonly #publishableKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: RestClientOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.#publishableKey = options.publishableKey;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /** Cursor-paginated history, walking backward from `before` (a message id) — mirrors `GET /sessions/{id}/messages`. */
  async listMessages(sessionId: string, auth: RestAuth, opts: { limit?: number; before?: string } = {}): Promise<MessagePage> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.before !== undefined) params.set('before', opts.before);
    const qs = params.toString();

    const response = await this.#fetch(
      `${this.#apiUrl}/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`,
      { headers: authHeaders(auth, this.#publishableKey) },
    );
    if (!response.ok) throw new RestError(response.status, await readErrorMessage(response));
    return (await response.json()) as MessagePage;
  }

  /** Step 1 of the upload-then-announce flow — mirrors `POST /sessions/{id}/attachments`. The caller still has to send a `message.send` frame with the returned metadata to actually announce it. */
  async uploadAttachment(sessionId: string, auth: RestAuth, file: Blob, fileName?: string): Promise<AttachmentMetadata> {
    const form = new FormData();
    form.append('file', file, fileName);

    const response = await this.#fetch(`${this.#apiUrl}/sessions/${encodeURIComponent(sessionId)}/attachments`, {
      method: 'POST',
      // Deliberately no Content-Type header — the platform's fetch sets the
      // multipart boundary itself; setting it manually breaks the boundary.
      headers: authHeaders(auth, this.#publishableKey),
      body: form,
    });
    if (!response.ok) throw new RestError(response.status, await readErrorMessage(response));
    return (await response.json()) as AttachmentMetadata;
  }

  /** `POST /sessions/{id}/close` — REST-only, no WS equivalent (§6.2 backs `client.closeSession()`). */
  async closeSession(sessionId: string, auth: RestAuth, reason?: CloseReason): Promise<ChatSession> {
    const response = await this.#fetch(`${this.#apiUrl}/sessions/${encodeURIComponent(sessionId)}/close`, {
      method: 'POST',
      headers: { ...authHeaders(auth, this.#publishableKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { reason } : {}),
    });
    if (!response.ok) throw new RestError(response.status, await readErrorMessage(response));
    return (await response.json()) as ChatSession;
  }

  /** `POST /sessions/{id}/reopen` — REST-only, routes straight to WAITING_FOR_AGENT, bypassing the bot (§6.2, §12.5). */
  async reopenSession(sessionId: string, auth: RestAuth): Promise<ChatSession> {
    const response = await this.#fetch(`${this.#apiUrl}/sessions/${encodeURIComponent(sessionId)}/reopen`, {
      method: 'POST',
      headers: authHeaders(auth, this.#publishableKey),
    });
    if (!response.ok) throw new RestError(response.status, await readErrorMessage(response));
    return (await response.json()) as ChatSession;
  }
}
