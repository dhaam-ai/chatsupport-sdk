import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  // tsup externalises `dependencies` and `peerDependencies` on its own, so
  // @dhaam-ccrm/widget is already external by virtue of being a peer. Named
  // anyway, next to react: <DhaamForm> must import the widget at runtime, not
  // carry a second copy of it. Two copies would mean two `WeakMap`s of mounted
  // forms — and the guard against mounting twice into one element is keyed on
  // exactly that map.
  external: ['react', 'react-dom', '@dhaam-ccrm/widget'],
});
