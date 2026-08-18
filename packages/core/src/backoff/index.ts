// Reconnect backoff policy — PRD §8.2 (formula), §10.6 (auth escalation).
//
// Two distinct policies over one shared full-jitter delay formula:
//   - TransportBackoffPolicy: transport failures retry indefinitely.
//   - AuthBackoffPolicy: auth failures escalate to suspend after a small
//     bounded number of consecutive attempts.
//
// Pure computation only — no timers, no scheduling. The connection state
// machine (task T8) owns scheduling the delays this module computes.

export type { AuthBackoffConfig, AuthBackoffOutcome } from './auth-backoff-policy';
export { AuthBackoffPolicy, DEFAULT_MAX_CONSECUTIVE_AUTH_FAILURES } from './auth-backoff-policy';
export type { BackoffConfig, RandomSource } from './full-jitter';
export { DEFAULT_BASE_MS, DEFAULT_CAP_MS, fullJitterDelay } from './full-jitter';
export { TransportBackoffPolicy } from './transport-backoff-policy';
