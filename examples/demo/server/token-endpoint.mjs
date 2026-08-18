// The server half of the two-key model.
//
// `POST /chat-services/api/v1/tokens` authenticates with the SECRET key and
// mints a short-lived access token for one user. That call can only happen
// somewhere the secret key lives, which is why this demo has a server process
// at all — a browser-only integration is not possible by design.
//
// Contract (chat-service-node src/api/rest/routes/token.routes.ts):
//   POST {apiUrl}/chat-services/api/v1/tokens
//   Authorization: Bearer dhsk_…
//   body    { userId, name?, email? }   — extra keys become custom JWT claims
//   201     { accessToken, expiresIn }  — expiresIn is SECONDS (RFC 6749)
//   4xx/5xx { error: { code, message, retryable } }

const TOKEN_PATH = '/chat-services/api/v1/tokens';

/** A token mint that failed. Never carries the secret key or the token. */
export class TokenMintError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'TokenMintError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Mints one access token.
 *
 * @param {object} options
 * @param {string} options.apiUrl      Origin of chat-service, no path.
 * @param {string} options.secretKey   `dhsk_…`. Never leaves this process.
 * @param {{ userId: string, name?: string }} options.user
 * @param {typeof globalThis.fetch} [options.fetchImpl]  Injectable for tests.
 * @returns {Promise<{ accessToken: string, expiresIn?: number }>}
 */
export async function mintAccessToken({ apiUrl, secretKey, user, fetchImpl = globalThis.fetch }) {
  let response;
  try {
    response = await fetchImpl(`${apiUrl}${TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        // The secret key is the credential here, and only here.
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      // userId comes from server config, NEVER from the browser request.
      // Taking it from the request would let any visitor mint a token for any
      // user — the demo would be an impersonation endpoint.
      body: JSON.stringify({ userId: user.userId, name: user.name }),
    });
  } catch (cause) {
    throw new TokenMintError(`cannot reach chat-service at ${apiUrl} — is it running?`, {});
  }

  const body = await readJson(response);

  if (!response.ok) {
    const code = typeof body?.error?.code === 'string' ? body.error.code : null;
    throw new TokenMintError(explainFailure(response.status, code), {
      status: response.status,
      code,
    });
  }

  if (typeof body?.accessToken !== 'string' || body.accessToken === '') {
    throw new TokenMintError('token endpoint returned no accessToken', { status: response.status });
  }

  // Returned verbatim. The browser hands this straight to core's
  // `createTokenProvider`, which understands `{ accessToken, expiresIn }` and
  // does the seconds→milliseconds conversion itself.
  return typeof body.expiresIn === 'number'
    ? { accessToken: body.accessToken, expiresIn: body.expiresIn }
    : { accessToken: body.accessToken };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Turns a status into something actionable.
 *
 * Never includes the response body: chat-service returns an identical generic
 * 401 for every auth failure on purpose (no enumeration oracle), and echoing
 * bodies risks reflecting request detail back out.
 */
function explainFailure(status, code) {
  if (status === 401) {
    return (
      'chat-service rejected the secret key (401). Check CHAT_SECRET_KEY is the dhsk_… value ' +
      'from `keys:create`, that it has not been revoked, and that it matches CHAT_API_URL’s tenant.'
    );
  }
  if (status === 429) {
    return 'chat-service rate-limited the token request (429). Wait and retry.';
  }
  if (status >= 500) {
    return (
      `chat-service failed to mint a token (${status}). If CHAT_ACCESS_TOKEN_SECRET is unset or ` +
      'shorter than 32 chars with NODE_ENV=production, minting refuses by design.'
    );
  }
  return `token mint failed with status ${status}${code ? ` (${code})` : ''}`;
}
