// Environment → validated demo config.
//
// The one rule this file exists to enforce: the secret key stays here. It is
// read into the Node process, used to call chat-service's token endpoint, and
// never templated into the page, never returned by any route, and never logged.
//
// Both keys are validated for *shape* at boot rather than on first request, so
// pasting them the wrong way round fails immediately and loudly instead of
// shipping a `dhsk_…` to a browser.

import { parsePublishableKey, publishableKeyEnvironment } from '@dhaam-ccrm/core';

const SECRET_KEY_PATTERN = /^dhsk_(live|test)_[A-Za-z0-9_-]{32,64}$/;

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(env, name, hint) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${name} is not set.\n  ${hint}`);
  }
  return value.trim();
}

/**
 * Reads and validates configuration.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{
 *   port: number, apiUrl: string, wsUrl: string,
 *   publishableKey: string, secretKey: string,
 *   user: { userId: string, name: string }, environment: 'live' | 'test'
 * }}
 */
export function loadConfig(env = process.env) {
  const publishableKey = required(
    env,
    'CHAT_PUBLISHABLE_KEY',
    'Run `npm run keys:create -- --tenant <id> --env test` in chat-service-node and copy the dhpk_… value.',
  );
  const secretKey = required(
    env,
    'CHAT_SECRET_KEY',
    'The dhsk_… value from the same keys:create run. It is shown once and never recoverable.',
  );

  // Core's own validator, reused rather than reimplemented. It raises
  // SecretKeyInClientError when a dhsk_ key is supplied where a dhpk_ one
  // belongs — exactly the paste-swap this check exists to catch.
  const parsedPublishable = parsePublishableKey(publishableKey);
  const environment = publishableKeyEnvironment(parsedPublishable);

  if (!SECRET_KEY_PATTERN.test(secretKey)) {
    // Deliberately does not echo the value.
    throw new ConfigError(
      'CHAT_SECRET_KEY is not a well-formed secret key (expected dhsk_live_… or dhsk_test_…).',
    );
  }

  // chat-service rejects the WebSocket handshake with "Credential tenant
  // mismatch" when the token's environment differs from the publishable key's.
  // That error arrives late and reads like a tenancy problem, so catch the
  // real cause — mismatched halves of two different keys:create runs — here.
  const secretEnvironment = secretKey.startsWith('dhsk_test_') ? 'test' : 'live';
  if (secretEnvironment !== environment) {
    throw new ConfigError(
      `Key environment mismatch: the publishable key is "${environment}" but the secret key is ` +
        `"${secretEnvironment}". Both must come from the same \`keys:create\` run.`,
    );
  }

  return {
    port: Number(env.DEMO_PORT ?? 5173),
    // Origin only — @dhaam-ccrm/rest appends /chat-services/api/v1 itself.
    apiUrl: (env.CHAT_API_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    // Full URL, given rather than derived: core refuses to guess a WS host
    // from an HTTP one (§12.7), and so does this demo.
    wsUrl: env.CHAT_WS_URL ?? 'ws://localhost:3000/chat-services/v2/ws',
    publishableKey,
    secretKey,
    environment,
    user: {
      userId: env.DEMO_USER_ID ?? 'demo-user-1',
      name: env.DEMO_USER_NAME ?? 'Demo User',
    },
  };
}

/** What the page is allowed to see. Note the absence of `secretKey`. */
export function toRuntimeConfig(config) {
  return {
    publishableKey: config.publishableKey,
    apiUrl: config.apiUrl,
    wsUrl: config.wsUrl,
    userId: config.user.userId,
    displayName: config.user.name,
  };
}

/** Boot banner. Prints the secret key's prefix only — never the key. */
export function describeConfig(config) {
  return [
    `  API      ${config.apiUrl}`,
    `  WS       ${config.wsUrl}`,
    `  Key env  ${config.environment}`,
    `  Pub key  ${config.publishableKey}`,
    `  Secret   dhsk_${config.environment}_… (loaded, never sent to the browser)`,
    `  User     ${config.user.userId} (${config.user.name})`,
  ].join('\n');
}
