import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // Rolls up @dhaam-ccrm/core's types into this package's own .d.ts —
    // core is a devDependency here (fully bundled, not a real runtime
    // dependency), so a bare `from '@dhaam-ccrm/core'` re-export would be
    // unresolvable for an external consumer. Same fix as packages/js.
    dts: { resolve: true },
    splitting: false,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    noExternal: ['@dhaam-ccrm/core'],
  },
  {
    entry: { 'chat-widget': 'src/index.ts' },
    format: ['iife'],
    globalName: 'ChatWidget',
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    target: 'es2020',
    noExternal: ['@dhaam-ccrm/core'],
    minify: true,
  },
]);
