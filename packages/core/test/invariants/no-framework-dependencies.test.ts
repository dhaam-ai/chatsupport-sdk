// GUARD 1 — PRD §15: core has zero framework and UI dependencies.
//
// The claim has two halves and needs both, because either one alone is
// trivially satisfiable while the invariant is broken:
//
//   DECLARED  — `package.json` lists no `dependencies`, `peerDependencies`, or
//               `optionalDependencies`. This is what a consumer's installer
//               reads, and what v1's manifest got wrong: it declared React and
//               `react-dom` as peers and `socket.io-client` as a hard runtime
//               dependency, which is precisely the coupling core exists to
//               remove.
//   REACHED   — no source file imports one either. A manifest can be clean
//               while the code imports React anyway (it resolves fine in a
//               monorepo, from a sibling package's `node_modules`, and breaks
//               only for the consumer who installs core on its own).
//
// The `findBareImports` assertion is the one that makes this hold TRANSITIVELY.
// A denylist of framework names cannot catch React arriving through some
// helper package, and enumerating the closure of every dependency's own
// dependencies is not something a unit test can do honestly. Core sidesteps
// the whole problem by importing NOTHING external: with zero dependency edges
// there is no path for a framework to arrive along, and that is checkable in
// one pass.
//
// Every detector used here is proved to trip on a real violation in
// `detectors.test.ts`. Without that file these assertions would be `[]` checks
// with nothing behind them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CORE_ROOT,
  coreSourceFiles,
  findBareImports,
  findDeclaredRuntimeDependencies,
  findFrameworkDependencies,
  findFrameworkImports,
} from './source-scan.js';

const manifest: unknown = JSON.parse(readFileSync(join(CORE_ROOT, 'package.json'), 'utf8'));
const sources = coreSourceFiles();

/** Renders violations into a message that names the file and line to go fix. */
function report(violations: readonly { path: string; line: number; detail: string }[]): string[] {
  return violations.map((v) => (v.line > 0 ? `${v.path}:${v.line} → ${v.detail}` : `${v.path} → ${v.detail}`));
}

describe('§15 guard: core declares no framework or UI dependencies', () => {
  it('sanity: the manifest under test is actually @dhaam-ccrm/core', () => {
    // Guards against the whole file silently passing because it parsed the
    // wrong package.json — every assertion below reads from this object.
    expect((manifest as { name?: string }).name).toBe('@dhaam-ccrm/core');
  });

  it('declares no dependencies, peerDependencies, or optionalDependencies at all', () => {
    expect(report(findDeclaredRuntimeDependencies(manifest))).toEqual([]);
  });

  it('names no framework or UI package in any manifest field, devDependencies included', () => {
    expect(report(findFrameworkDependencies(manifest))).toEqual([]);
  });
});

describe('§15 guard: core imports no framework or UI package', () => {
  it('sanity: there is source to scan', () => {
    expect(sources.length).toBeGreaterThan(40);
  });

  it('imports no React, Vue, Angular, Svelte, or socket.io-client', () => {
    expect(report(findFrameworkImports(sources))).toEqual([]);
  });

  it('imports nothing external whatsoever, so no framework can arrive transitively', () => {
    // Also the React Native / browser portability check: `node:fs` and friends
    // are bare imports too, and neither runtime has them.
    expect(report(findBareImports(sources))).toEqual([]);
  });
});
