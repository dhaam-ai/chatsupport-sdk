import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      // examples/demo covers the one piece of logic it owns: keeping the
      // secret key out of everything the browser can reach.
      'examples/*/test/**/*.test.ts',
      // /src is the legacy React SDK on socket.io v1 — a separate stack from
      // packages/core. Neither react nor socket.io-client is installed at the
      // root, so only its React-free, transport-free logic modules are
      // testable here; those are deliberately kept importable on their own.
      'src/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
    },
  },
});
