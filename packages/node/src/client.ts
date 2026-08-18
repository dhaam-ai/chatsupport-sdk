// The ergonomic client — the hand-written layer over the OpenAPI contract.
//
// T19 generates Python and Go clients from the same document. This is the
// TypeScript equivalent, written by hand because the ergonomics that matter
// here (a branded secret key, an async-iterable history, a webhook verifier
// that cannot be called with the wrong credential) are exactly the things a
// generator does not produce.
//
// ── Why the credential model shapes the object model ─────────────────────
//
// The secret key is valid on `POST /tokens` AND NOWHERE ELSE — never on any
// endpoint a browser calls. Every session and message route requires an
// `accessToken` plus the publishable key instead. A client that held the
// secret key and also exposed `listMessages()` would therefore be lying about
// what it can do, and the natural way to make that lie true is to start
// sending the secret key on browser-facing routes.
//
// So the surface is split to match the credentials:
//
//   ChatServerClient          holds the secret key. Mints tokens. Verifies
//                             webhooks. Cannot read a session.
//   ChatServerClient.asUser() takes an access token and returns a reader
//                             scoped to that user. Never sees the secret key.
//
// The split is not ceremony: it is the authorization model made visible, so
// the question "which credential does this call use?" is answered by which
// object you are holding.

import { HttpClient } from './http.js';
import { parseSecretKey, type SecretKey } from './keys.js';
import { mintAccessToken } from './tokens.js';
import {
  listMessagePages,
  listMessages,
  type ListMessagesOptions,
  type Page,
} from './pagination.js';
import {
  assertWebhookSignature,
  constructWebhookEvent,
  verifyWebhookSignature,
  type ReceivedWebhookEvent,
  type WebhookVerifyOptions,
} from './webhooks.js';
import type { ChatMessage, MintTokenRequest, MintTokenResponse } from './types.js';

/** Webhook options with the secret key already supplied by the client. */
export type BoundWebhookVerifyOptions = Omit<WebhookVerifyOptions, 'secretKey'>;

export interface ChatServerClientOptions {
  /**
   * Origin of your chat-service deployment — scheme and host, no path.
   *
   * There is no default. The PRD explicitly rejects deriving this from a
   * WebSocket URL by port-swap heuristics, and there is no single fixed
   * multi-tenant domain to hardcode, so a wrong value must fail loudly rather
   * than silently address someone else's deployment.
   */
  readonly apiUrl: string;

  /**
   * Your `dhk_live_…` / `dhk_test_…` secret key.
   *
   * Read it from the environment. If this value is in your source tree it is
   * in your git history, and rotating it is the only remedy.
   */
  readonly secretKey: SecretKey | string;

  /**
   * Your `dhp_live_…` / `dhp_test_…` publishable key.
   *
   * Required only for {@link ChatServerClient.asUser} — every browser-facing
   * route needs it alongside the access token. Omit it if this process only
   * mints tokens and verifies webhooks.
   */
  readonly publishableKey?: string;

  /** Defaults to the global `fetch` (Node 18+). Injectable for tests. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * A read surface scoped to one end user, authenticated by their access token.
 *
 * Deliberately has no access to the secret key: it is constructed with only
 * the two credentials a browser would also hold, so nothing reachable from
 * here can escalate to minting a token for a different user.
 */
export class UserScopedClient {
  readonly #http: HttpClient;

  /** @internal Constructed via {@link ChatServerClient.asUser}. */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Page through a session's message history.
   *
   * ```ts
   * for await (const page of user.messagePages(sessionId)) {
   *   console.log(page.items.length, page.hasMore);
   * }
   * ```
   */
  messagePages(
    sessionId: string,
    options: ListMessagesOptions = {},
  ): AsyncGenerator<Page<ChatMessage>, void, undefined> {
    return listMessagePages(this.#http, sessionId, options);
  }

  /**
   * Iterate a session's messages, page boundaries flattened away.
   *
   * ```ts
   * for await (const message of user.messages(sessionId)) {
   *   console.log(message.content);
   * }
   * ```
   */
  messages(
    sessionId: string,
    options: ListMessagesOptions = {},
  ): AsyncGenerator<ChatMessage, void, undefined> {
    return listMessages(this.#http, sessionId, options);
  }
}

/**
 * The backend SDK. Holds the secret key; runs only on your own server.
 *
 * ```ts
 * const chat = new ChatServerClient({
 *   apiUrl: process.env.CHAT_API_URL!,
 *   secretKey: process.env.CHAT_SECRET_KEY!,
 * });
 *
 * // In YOUR authenticated endpoint — never trust a browser-supplied userId:
 * const { accessToken } = await chat.mintToken({ userId: session.user.id });
 * ```
 */
export class ChatServerClient {
  readonly #secretKey: SecretKey;
  readonly #publishableKey: string | undefined;
  readonly #apiUrl: string;
  readonly #fetch: typeof globalThis.fetch | undefined;
  readonly #http: HttpClient;

  constructor(options: ChatServerClientOptions) {
    // Validated at construction, as early as the key enters the process. A
    // malformed secret key is an unrecoverable configuration error, and
    // failing here beats failing after a network round trip that returns a
    // deliberately uninformative 401. This is also the call that turns a
    // publishable key supplied by mistake into a named incident.
    this.#secretKey = parseSecretKey(options.secretKey);
    this.#publishableKey = options.publishableKey;
    this.#apiUrl = options.apiUrl;
    this.#fetch = options.fetch;

    this.#http = new HttpClient({
      apiUrl: options.apiUrl,
      // A function, not a captured header object, so the key is read at call
      // time and never sits in a second long-lived structure.
      authHeaders: () => ({ Authorization: `Bearer ${this.#secretKey}` }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  /**
   * Mint a short-lived access token for one of your users.
   *
   * Call this from an endpoint of your own that has ALREADY established who is
   * asking. `userId` is taken on trust — forwarding a browser-supplied value
   * here lets any visitor mint a token for any user.
   *
   * Relay only `accessToken` to the browser. Never the secret key.
   */
  async mintToken(request: MintTokenRequest): Promise<MintTokenResponse> {
    return mintAccessToken(this.#http, request);
  }

  /**
   * Verify a webhook delivery and return its parsed event.
   *
   * The secret key is supplied from this client, so it cannot be forgotten or
   * mixed up with the publishable key at the call site.
   *
   * ```ts
   * app.post('/webhooks/chat', express.raw({ type: 'application/json' }), (req, res) => {
   *   try {
   *     const event = chat.constructWebhookEvent({
   *       payload: req.body,                                  // the RAW body
   *       signatureHeader: req.header('X-ChatSDK-Signature')!,
   *     });
   *     // Delivery is at-least-once — dedupe on event.id before acting.
   *     res.sendStatus(204);
   *   } catch {
   *     res.sendStatus(400);
   *   }
   * });
   * ```
   */
  constructWebhookEvent(options: BoundWebhookVerifyOptions): ReceivedWebhookEvent {
    return constructWebhookEvent({ ...options, secretKey: this.#secretKey });
  }

  /** Verify a delivery, throwing {@link WebhookVerificationError} on failure. */
  assertWebhookSignature(options: BoundWebhookVerifyOptions): void {
    assertWebhookSignature({ ...options, secretKey: this.#secretKey });
  }

  /** Non-throwing signature check. Prefer {@link ChatServerClient.constructWebhookEvent}. */
  verifyWebhookSignature(options: BoundWebhookVerifyOptions): boolean {
    return verifyWebhookSignature({ ...options, secretKey: this.#secretKey });
  }

  /**
   * A read surface scoped to one user, authenticated by their access token.
   *
   * Requires `publishableKey` — every browser-facing route needs both
   * credentials, and the server rejects a request whose publishable key does
   * not match the token's tenant with `401 AUTH_INVALID`.
   */
  asUser(accessToken: string): UserScopedClient {
    if (typeof accessToken !== 'string' || accessToken === '') {
      // No prefix, no length. A token is credential material (§14).
      throw new Error('an access token is required — mint one with mintToken() first');
    }
    const publishableKey = this.#publishableKey;
    if (publishableKey === undefined || publishableKey === '') {
      throw new Error(
        'publishableKey is required to read sessions or messages: every browser-facing ' +
          'route needs it alongside the access token. Pass it to the ChatServerClient ' +
          'constructor. It is safe to ship in a client bundle; the secret key is not.',
      );
    }

    return new UserScopedClient(
      new HttpClient({
        apiUrl: this.#apiUrl,
        // The secret key is deliberately absent from these headers. This
        // surface talks to routes a browser also calls, and the secret key is
        // valid on none of them.
        authHeaders: () => ({
          Authorization: `Bearer ${accessToken}`,
          'X-Publishable-Key': publishableKey,
        }),
        ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      }),
    );
  }

  /**
   * Redacted representation.
   *
   * `toJSON` and the Node inspect hook are both overridden so that
   * `JSON.stringify(client)`, `console.log(client)` and a structured logger's
   * serializer all refuse to emit the key. Without these, a customer logging
   * their config object at startup writes the secret key to disk — the exact
   * §14 failure this package exists to prevent, arrived at by an entirely
   * reasonable-looking line of code.
   *
   * The private `#secretKey` field is already invisible to `JSON.stringify`,
   * but not to every logger's own traversal, and relying on that is a bet on
   * an implementation detail of whichever library the customer chose.
   */
  toJSON(): Record<string, unknown> {
    return { apiUrl: this.#apiUrl, secretKey: '[redacted]' };
  }

  /** Node's `util.inspect` / `console.log` hook. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `ChatServerClient { apiUrl: ${JSON.stringify(this.#apiUrl)}, secretKey: [redacted] }`;
  }
}
