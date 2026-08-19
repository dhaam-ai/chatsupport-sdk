// Reports what a page actually pays for this package.
//
// Bundle size matters more here than in any other binding: this is the
// substrate for a floating widget delivered by a script tag on a customer's
// site, where every kilobyte is charged to someone else's page-load budget.
// So the number that matters is the built ESM bundle, minified and gzipped,
// with `@dhaam-ccrm/core` external — a page carries exactly one copy of core
// no matter how many bindings sit on it.
//
// Three entry points are measured, not one, because "the package size" is the
// wrong question for a tree-shakeable barrel: what a widget pays is what it
// imports. The gap between the first and second rows is the proof that the
// barrel really does shake.

import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = join(packageRoot, '.size-tmp');

const ENTRIES = [
  ['whole barrel (`export *`)', "export * from '../dist/index.js';"],
  ['createChatStore + shallowEqual — a widget that owns its client', "export { createChatStore, shallowEqual } from '../dist/index.js';"],
  ['createChat alone — the one-call entry, without the equality helpers', "export { createChat } from '../dist/index.js';"],
];

mkdirSync(scratch, { recursive: true });
try {
  for (const [label, source] of ENTRIES) {
    const entry = join(scratch, 'entry.js');
    const outfile = join(scratch, 'out.js');
    writeFileSync(entry, source);
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      minify: true,
      format: 'esm',
      target: 'es2020',
      external: ['@dhaam-ccrm/core'],
      logLevel: 'silent',
    });
    const bytes = readFileSync(outfile);
    const gzipped = gzipSync(bytes, { level: 9 });
    console.log(`${String(bytes.length).padStart(5)} B min  ${String(gzipped.length).padStart(4)} B gzip   ${label}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
