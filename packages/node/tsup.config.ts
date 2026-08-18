import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // `node18` rather than core's `es2020`. This package is never bundled for a
  // browser (PRD §14) and its floor is the Node version that first shipped
  // global `fetch`, so there is nothing to gain from downlevelling further.
  target: 'node18',
  platform: 'node',
  // Keep the `node:` prefix in the emitted output. esbuild strips it by
  // default, and the bare `crypto` specifier it leaves behind is one a browser
  // bundler will happily satisfy with a `crypto-browserify` shim — silently
  // producing a "working" browser build of the package that holds the secret
  // key. `node:crypto` cannot be resolved that way, so preserving the prefix
  // is part of what makes this package structurally node-only (§14) rather
  // than node-only by documentation.
  // tsup rewrites `node:crypto` to a bare `crypto` by default, for the sake of
  // Node versions older than 14.18. Our floor is 18, and the rewrite is
  // actively harmful here: `crypto` is a specifier a browser bundler will
  // happily satisfy with a `crypto-browserify` shim, silently producing a
  // "working" browser build of the package that holds the secret key.
  // `node:crypto` cannot be resolved that way, so keeping the prefix is part
  // of what makes this package structurally node-only (§14) rather than
  // node-only by documentation. Asserted in `test/packaging.test.ts`.
  removeNodeProtocol: false,
});
