import { defineConfig } from 'tsup';

// The npm-package build only. The script-tag bundle (`dist/widget.js`) is a
// different artifact with different rules — self-contained, IIFE, everything
// inlined — and is produced by scripts/bundle.mjs, which also reports its
// gzipped weight.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  // External for the package build so a bundler-using consumer carries one
  // copy of core. Deliberately NOT external for the script-tag bundle.
  external: ['@dhaam-ccrm/core', '@dhaam-ccrm/js', '@dhaam-ccrm/rest'],
});
