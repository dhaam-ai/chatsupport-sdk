// Building a ChatClientConfig from nothing but the published package surfaces.
//
// This file is the actual dogfooding: every import below is a package entry
// point (`@dhaam-ccrm/core`, `@dhaam-ccrm/rest`) — no deep import into any
// `packages/*/src/*`. If something here reads awkwardly, that is a finding
// about the SDK, not about the demo; see README "What integrating actually
// felt like".

import {
  createTokenProvider,
  type AccessTokenResponse,
  type ChatClientConfig,
  type ChatMessage,
  type ChatSession,
  type AttachmentMetadata,
} from '@dhaam-ccrm/core';
import {
  RestClient,
  createAttachmentUploader,
  createHistorySource,
  createSessionActions,
} from '@dhaam-ccrm/rest';

import type { DemoRuntimeConfig } from './runtime-config';

/** Where the browser asks for a token. Backed by the Node process, never by chat-service directly. */
const TOKEN_ENDPOINT = '/api/token';

/**
 * Holds the most recently minted access token.
 *
 * ── Why this exists at all ──
 *
 * Two different consumers need the token and the SDK does not connect them:
 *
 *   - `ChatClientConfig.getToken` — core calls this. Core owns *when*: before
 *     the first connect, before each reconnect, and on proactive/reactive
 *     refresh (§10.4).
 *   - `RestClientOptions.getAccessToken` — the REST adapters call this, once
 *     per HTTP request.
 *
 * Core never exposes the token it is currently using, so the REST side cannot
 * ask core for it. The integrator has to keep their own copy and hand it to
 * both. That is what this class is, and it is the single most awkward thing
 * about wiring the SDK up — see README.
 *
 * The cache is only ever *written* on a successful mint, so REST always uses
 * the newest token core obtained rather than an independently-fetched one.
 */
class TokenStore {
  #accessToken: string | null = null;

  /**
   * Mints a fresh token. Passed to `createTokenProvider`, so core calls it
   * whenever it decides a refresh is due — it must never return a cached
   * value, or core would reinstall the same expiring credential forever.
   */
  mint = async (): Promise<AccessTokenResponse> => {
    const response = await fetch(TOKEN_ENDPOINT, { method: 'POST' });

    if (!response.ok) {
      // The body may carry a chat-service error envelope; surface only its
      // code, never the raw body — it is attacker-influencable, and this
      // message reaches `ChatState.lastError`.
      const detail = await readErrorCode(response);
      throw new Error(`token endpoint returned ${response.status}${detail ? ` (${detail})` : ''}`);
    }

    const body = (await response.json()) as AccessTokenResponse;
    this.#accessToken = body.accessToken;
    return body;
  };

  /** The token the REST adapters should present. Mints one if none exists yet. */
  current = async (): Promise<string> => {
    if (this.#accessToken === null) await this.mint();
    if (this.#accessToken === null) throw new Error('token endpoint returned no accessToken');
    return this.#accessToken;
  };
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    const code = body?.error?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/**
 * Assembles the config `ChatProvider` builds a client from.
 *
 * Note which fields are required at construction: `publishableKey`,
 * `getToken`, `wsUrl`, `localSender` and `history`. `uploader` and
 * `sessionActions` are optional and throw `ChatClientConfigError` only if the
 * corresponding method is called — so they are wired here purely because the
 * REST package makes them one line each.
 */
export function buildChatConfig(runtime: DemoRuntimeConfig): ChatClientConfig {
  const tokens = new TokenStore();

  const rest = new RestClient({
    apiUrl: runtime.apiUrl,
    publishableKey: runtime.publishableKey,
    getAccessToken: tokens.current,
  });

  return {
    publishableKey: runtime.publishableKey,

    // `createTokenProvider` rather than a hand-rolled `async () => ...`.
    // chat-service returns `{ accessToken, expiresIn }` where `expiresIn` is
    // SECONDS (RFC 6749), but core's native field is `expiresInMs`. The
    // obvious hand-written adapter turns a 3600-second token into a 3600ms
    // one and refreshes every ~2.9s forever. This helper does the unit
    // conversion, so that error is unwritable.
    getToken: createTokenProvider(tokens.mint),

    // Origin only. Core itself never reads `apiUrl` (it makes no HTTP calls);
    // it is passed so the whole integration reads from one config object.
    apiUrl: runtime.apiUrl,
    wsUrl: runtime.wsUrl,

    // Required, and correctly so: `ChatSession` carries both a `customer` and
    // an `assignedAgent`, so nothing else here tells core which one this
    // browser is. A customer-side widget is always CUSTOMER.
    localSender: { senderId: runtime.userId, senderType: 'CUSTOMER' },

    // The explicit type arguments are load-bearing: these factories are
    // generic over the wire shape and infer `unknown` without them, which
    // then fails to satisfy `MessageHistorySource`. See README.
    history: createHistorySource<ChatMessage>(rest),
    uploader: createAttachmentUploader<AttachmentMetadata>(rest),
    sessionActions: createSessionActions<ChatSession>(rest),

    // §14: core promises this never receives credentials or message content.
    logger: (level, message, meta) => {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'log' : level](`[chat-sdk] ${message}`, meta ?? '');
    },
  };
}
