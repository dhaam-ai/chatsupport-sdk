// Verifies the *built* IIFE artifact (dist/chat-sdk.global.js), not source —
// the same lesson from packages/core's smoke test (see PLAN-v2-core-adoption.md):
// a bundler config can typecheck clean and still produce broken output.
// Runs the actual built file in a fresh JS realm via node:vm, simulating a
// plain `<script src="chat-sdk.global.js">` page with no bundler — no jsdom
// needed, since what matters here is "does a bare top-level `var` land as a
// global," which node:vm's context object reproduces exactly.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const distFile = join(here, '..', 'dist', 'chat-sdk.global.js');

describe('dist/chat-sdk.global.js (built IIFE)', () => {
  beforeAll(() => {
    if (!existsSync(distFile)) {
      throw new Error(`${distFile} does not exist — run "pnpm --filter @dhaam-ccrm/js build" before this test.`);
    }
  });

  function loadInFreshRealm(): Record<string, unknown> {
    // A bare vm context is an isolated ECMAScript realm with none of the
    // web-platform globals a real browser always provides — unlike Node's
    // own top-level scope, it doesn't inherit them for free. Providing them
    // explicitly is what makes this a fair simulation of a <script> tag
    // rather than a stricter-than-reality sandbox.
    const context: Record<string, unknown> = { console, URL, fetch, WebSocket };
    vm.createContext(context);
    vm.runInContext(readFileSync(distFile, 'utf8'), context, { filename: 'chat-sdk.global.js' });
    return context;
  }

  it('attaches a global named ChatSDK when evaluated as a plain script', () => {
    const context = loadInFreshRealm();
    expect(context.ChatSDK).toBeDefined();
    expect(typeof context.ChatSDK).toBe('object');
  });

  it('exposes createChatClient as a callable on the global, matching the ESM export', () => {
    const context = loadInFreshRealm();
    const chatSdk = context.ChatSDK as { createChatClient?: unknown };
    expect(typeof chatSdk.createChatClient).toBe('function');
  });

  it('a client built from the global build can be constructed without throwing', () => {
    const context = loadInFreshRealm();
    const chatSdk = context.ChatSDK as {
      createChatClient: (config: { publishableKey: string; apiUrl: string }) => { getState: () => unknown; destroy: () => void };
    };

    const client = chatSdk.createChatClient({ publishableKey: 'pk_test', apiUrl: 'http://unused.invalid' });

    expect(client.getState()).toMatchObject({ connectionState: 'idle' });
    client.destroy();
  });
});
