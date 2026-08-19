import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  // React is intentionally NOT external/bundled here: nothing under src/
  // imports it (the react reference adapter lives under test/, not src/ —
  // see src/index.ts's module header for why). If a future change adds a
  // react import to src/, this should gain `external: ['react', 'react-dom']`
  // the same way packages/react/tsup.config.ts does.
});
