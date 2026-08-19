import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  // No code-splitting: this package has exactly one entry point, and a split
  // build would hand a `<script type="module">` widget a second network round
  // trip for a few hundred bytes.
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  // `@dhaam-ccrm/core` stays external — a widget bundle should contain exactly
  // one copy of core, resolved by the consumer's bundler, not one copy per
  // binding that depends on it.
  external: ['@dhaam-ccrm/core'],
});
