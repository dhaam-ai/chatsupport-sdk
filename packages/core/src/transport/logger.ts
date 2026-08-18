// Transport logging, with credential redaction built into the seam.
//
// PRD §14: "No credential (token, secret key) is ever passed to `logger` or
// included in any log line core emits." v1 logged token prefixes and lengths
// — a prefix is still credential material and a length is still an oracle, so
// neither is reproduced here.
//
// The redaction is structural rather than a discipline: `frameLogContext` is
// the ONLY way a frame reaches a log line from this module, and it is an
// allowlist of four envelope fields. `d` is never read except for the one
// enum-valued `code`. There is no code path that can log `d.token`, because
// there is no code path that reads `d.token`.
//
// `warn` is the whole interface. §14 requires malformed frames to be "dropped
// with a logged warning", and every other condition worth emitting from this
// layer (an ack that correlates to nothing, a non-text frame, a send that
// threw) is likewise an anomaly rather than a trace. One method means a
// consumer's adapter is one line.

/** Where the transport reports anomalies. */
export interface TransportLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

/**
 * The default logger: `globalThis.console.warn`, probed lazily so importing
 * this module touches no global and a console-less runtime degrades to a
 * silent no-op rather than throwing.
 *
 * A library that logs by default is the right trade here — silently dropping
 * frames is the failure mode §14's "logged warning" exists to prevent. Pass
 * your own `TransportLogger` to route this elsewhere or to silence it.
 */
export const consoleLogger: TransportLogger = {
  warn(message, context) {
    const console = (globalThis as { console?: { warn?: (...args: unknown[]) => void } }).console;
    if (typeof console?.warn !== 'function') return;

    if (context === undefined) console.warn(message);
    else console.warn(message, context);
  },
};

/** Discards everything. */
export const silentLogger: TransportLogger = {
  warn() {
    /* intentionally empty */
  },
};

/**
 * Extracts the only frame fields that may ever appear in a log line.
 *
 * Accepts `unknown` because inbound frames are logged precisely when they
 * failed validation — the value may be any shape, or not an object at all.
 *
 * Returns, when present and of the right primitive type:
 * - `t`   frame type
 * - `id`  envelope ULID
 * - `ref` correlation id
 * - `errorCode` from `d.code`, which is a closed enum (protocol/errors.ts)
 *
 * Everything else in `d` — `token`, `publishableKey`, message `content`,
 * `metadata` — is dropped. No prefixes, no lengths, no hashes.
 */
export function frameLogContext(frame: unknown): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  if (typeof frame !== 'object' || frame === null) return context;

  const record = frame as Record<string, unknown>;

  if (typeof record['t'] === 'string') context['t'] = record['t'];
  if (typeof record['id'] === 'string') context['id'] = record['id'];
  if (typeof record['ref'] === 'string') context['ref'] = record['ref'];

  const payload = record['d'];
  if (typeof payload === 'object' && payload !== null) {
    const code = (payload as Record<string, unknown>)['code'];
    if (typeof code === 'string') context['errorCode'] = code;
  }

  return context;
}
