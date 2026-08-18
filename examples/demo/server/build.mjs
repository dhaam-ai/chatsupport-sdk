// Bundles the browser app.
//
// esbuild rather than a dev-server framework so that `npm start` is genuinely
// one process: the HTTP server (server/index.mjs) imports `bundle()` and runs
// it on boot, then serves the result. Nothing here is SDK-specific — it is a
// stand-in for whatever bundler a real customer already has.
//
// The one thing worth noticing: `@dhaam-ccrm/core`, `/rest` and `/react` are
// resolved by esbuild through their package.json `exports` field, i.e. through
// `dist/`, not `src/`. That is the same path a customer's bundler takes from
// npm, which is the point of this demo — see README "Consuming the public
// surface". It also means the packages must be built before this runs.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
export const demoRoot = join(here, '..');
export const publicDir = join(demoRoot, 'public');

/** Built package entrypoints this demo consumes. Checked up front so a missing */
/** build fails with an instruction instead of an esbuild resolution stack. */
const REQUIRED_DISTS = [
  ['@dhaam-ccrm/core', join(demoRoot, 'node_modules/@dhaam-ccrm/core/dist/index.js')],
  ['@dhaam-ccrm/rest', join(demoRoot, 'node_modules/@dhaam-ccrm/rest/dist/index.js')],
  ['@dhaam-ccrm/react', join(demoRoot, 'node_modules/@dhaam-ccrm/react/dist/index.js')],
];

function assertPackagesBuilt() {
  const missing = REQUIRED_DISTS.filter(([, path]) => !existsSync(path)).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `these packages have no dist/ yet: ${missing.join(', ')}\n` +
        `They are consumed through their package.json "exports" (dist/), exactly as from npm.\n` +
        `Run "pnpm -r build" from the repo root first.`,
    );
  }
}

/** Bundles src/main.tsx to public/app.js. Returns the esbuild result. */
export async function bundle({ minify = false } = {}) {
  assertPackagesBuilt();

  return esbuild.build({
    entryPoints: [join(demoRoot, 'src/main.tsx')],
    outfile: join(publicDir, 'app.js'),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    jsx: 'automatic',
    sourcemap: true,
    minify,
    logLevel: 'info',
    // React 18 ships CJS and reads this; without it the dev build warns and
    // the prod build keeps development-only code.
    define: { 'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development') },
  });
}

// `node server/build.mjs` — build only, no server.
if (import.meta.url === `file://${process.argv[1]}`) {
  await bundle({ minify: process.argv.includes('--minify') });
}
