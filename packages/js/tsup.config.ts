import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM/CJS — for bundler-based consumers, mirrors core's own output shape.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // `resolve: true` rolls up @dhaam-ccrm/core's types into this package's
    // own .d.ts instead of leaving a bare `from '@dhaam-ccrm/core'` re-export
    // — that specifier is only resolvable inside this pnpm workspace (core
    // isn't published anywhere), and @dhaam-ccrm/core is a devDependency
    // here (not a real dependency — its JS is fully bundled in below), so an
    // external consumer's TypeScript build would fail to resolve it otherwise.
    dts: { resolve: true },
    splitting: false,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    noExternal: ['@dhaam-ccrm/core'],
  },
  // IIFE global build — the actual point of this package: a plain
  // `<script src="chat-sdk.global.js">` with no bundler, no module
  // resolution, exposing `window.ChatSDK`.
  {
    entry: { 'chat-sdk': 'src/index.ts' },
    format: ['iife'],
    globalName: 'ChatSDK',
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    target: 'es2020',
    noExternal: ['@dhaam-ccrm/core'],
    minify: true,
  },
]);
