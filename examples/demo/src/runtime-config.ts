// Config the server hands to the page at load time.
//
// Everything here is public by construction. The secret key (`dhsk_…`) is
// deliberately absent: it never leaves the Node process (see
// server/token-endpoint.mjs). The publishable key is designed to ship in a
// browser bundle — that asymmetry is the whole point of the two-key model.

export interface DemoRuntimeConfig {
  /** `dhpk_live_…` / `dhpk_test_…`. Safe in the browser. */
  readonly publishableKey: string;
  /** Origin only — the REST adapter appends `/chat-services/api/v1` itself. */
  readonly apiUrl: string;
  /** Full WebSocket URL, e.g. `ws://localhost:3000/chat-services/v2/ws`. */
  readonly wsUrl: string;
  /** Who this browser is. Mirrors the `userId` the server mints tokens for. */
  readonly userId: string;
  readonly displayName: string;
}

declare global {
  interface Window {
    __DEMO_CONFIG__?: DemoRuntimeConfig;
  }
}

export function readRuntimeConfig(): DemoRuntimeConfig {
  const config = window.__DEMO_CONFIG__;
  if (!config) {
    throw new Error(
      'window.__DEMO_CONFIG__ is missing — the page must be served by server/index.mjs, not opened from disk.',
    );
  }
  return config;
}
