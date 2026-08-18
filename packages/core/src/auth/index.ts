// Auth module barrel — PRD §10 (auth flows), §14 (security).
//
// ── What lives here, and what does not ───────────────────────────────────
//
// Most of §10 is already implemented in `connection/`, and correctly so: the
// proactive 80% refresh (§10.4), the reactive `AUTH_EXPIRED` path (§10.4),
// in-place `connection.reauth` with a transparent-reconnect fallback (§10.5),
// and escalation to `suspended` after three consecutive auth failures
// (§10.6). Those are decisions about WHEN to act, they are inseparable from
// the connection state machine, and duplicating them here would create two
// authorities on the same behaviour.
//
// This module owns the parts of §10 that are not state-machine decisions —
// the credential handling that happens at the EDGE, before a token or a key
// ever reaches the controller:
//
//   keys.ts          §10.1/§10.2/§14  publishable-key validation, and making
//                                     a secret key structurally unable to
//                                     reach client code. §10.7 rotation is
//                                     documented on the type itself.
//   token-source.ts  §10.3/§10.4      adapting real token-endpoint responses
//                                     to the `TokenProvider` seam, including
//                                     the seconds-to-milliseconds conversion
//                                     that is silently wrong when hand-written.
//   redact.ts        §14              keeping credentials out of log lines and
//                                     error messages.
//
// Nothing here holds state, starts a timer, or touches the network. Every
// function is pure, so the security properties are testable by inspection and
// by direct assertion rather than through a connection lifecycle.
//
// As with the other module barrels, this decides what `auth/` exposes to the
// rest of core. T13's `src/index.ts` decides what leaves the package.

export {
  InvalidPublishableKeyError,
  SecretKeyInClientError,
  isPublishableKey,
  parsePublishableKey,
  publishableKeyEnvironment,
} from './keys.js';
export type { PublishableKey, PublishableKeyEnvironment } from './keys.js';

export { InvalidTokenResponseError, createTokenProvider, toAuthToken } from './token-source.js';
export type { AccessTokenResponse, OAuthTokenResponse, TokenResponse } from './token-source.js';

export { REDACTED, containsCredentialMaterial, redact, scrubCredentials } from './redact.js';
