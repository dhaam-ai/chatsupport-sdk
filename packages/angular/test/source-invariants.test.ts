// Three claims this package makes in prose, turned into tests.
//
//   1. The SHIPPED package uses only documented `@angular/core` public API —
//      no `ɵ`-prefixed internals. (The test tree does use three, isolated in
//      angular-test-host.ts; that is why this scan covers `src/` only.)
//   2. It consumes `@dhaam-ccrm/core` through its public barrel and nothing
//      else — PRD §6.4's "bindings must use these two primitives and nothing
//      else... they may not reach into WS/REST/storage directly" is enforced
//      at the import graph, not just by review.
//   3. It has no RxJS surface. The signals-vs-observables decision (see
//      chat-store.ts's header) is only worth anything if a second reactive
//      surface cannot quietly grow back.
//
// Each detector is also run against a synthetic file containing a KNOWN
// violation. A detector that only ever sees the real (clean) tree is a
// permanently green test: it passes identically whether its pattern is right,
// wrong, or matches nothing at all.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface SourceFile {
  readonly path: string;
  readonly code: string;
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readSourceFiles(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...readSourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    out.push({ path: relative(PACKAGE_ROOT, full).split(sep).join('/'), code: readFileSync(full, 'utf8') });
  }
  return out;
}

/** Every `from '...'` / `import '...'` specifier in a file, comments and all — a string literal in a comment is not an import, so comments are stripped first. */
function importSpecifiers(file: SourceFile): string[] {
  const withoutComments = file.code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...withoutComments.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

function findPrivateAngularApi(file: SourceFile): string[] {
  // No `\b` anchor: `ɵ` (U+0275) is not a `\w` character, so a word boundary
  // never matches before it. Any occurrence at all is a violation.
  return [...file.code.matchAll(/ɵ[A-Za-z_0-9]*/g)].map((match) => match[0] ?? '');
}

function findNonBarrelImports(file: SourceFile): string[] {
  return importSpecifiers(file).filter(
    (specifier) => specifier.startsWith('@dhaam-ccrm/core/') || specifier.startsWith('@angular/core/'),
  );
}

function findRxjsImports(file: SourceFile): string[] {
  return importSpecifiers(file).filter(
    (specifier) => specifier === 'rxjs' || specifier.startsWith('rxjs/') || specifier.endsWith('rxjs-interop'),
  );
}

const SRC_FILES = readSourceFiles(join(PACKAGE_ROOT, 'src'));

describe('shipped source invariants', () => {
  it('scans a non-empty src/ tree (a detector over zero files proves nothing)', () => {
    expect(SRC_FILES.length).toBeGreaterThan(3);
  });

  it('uses no ɵ-prefixed Angular internals', () => {
    const violations = SRC_FILES.flatMap((file) => findPrivateAngularApi(file).map((hit) => `${file.path}: ${hit}`));
    expect(violations).toEqual([]);
  });

  it('imports @dhaam-ccrm/core and @angular/core only through their public entry points', () => {
    const violations = SRC_FILES.flatMap((file) => findNonBarrelImports(file).map((hit) => `${file.path}: ${hit}`));
    expect(violations).toEqual([]);
  });

  it('has no RxJS import anywhere — signals are the only reactive surface', () => {
    const violations = SRC_FILES.flatMap((file) => findRxjsImports(file).map((hit) => `${file.path}: ${hit}`));
    expect(violations).toEqual([]);
  });
});

describe('the detectors themselves', () => {
  const violating: SourceFile = {
    path: 'synthetic.ts',
    code: [
      "import { ɵEffectScheduler } from '@angular/core';",
      "import { deriveTickState } from '@dhaam-ccrm/core/messages/ticks.js';",
      "import { toObservable } from '@angular/core/rxjs-interop';",
      "import { map } from 'rxjs/operators';",
      'export const scheduler = ɵEffectScheduler;',
    ].join('\n'),
  };

  const clean: SourceFile = {
    path: 'synthetic-clean.ts',
    code: ["import { computed } from '@angular/core';", "import type { ChatState } from '@dhaam-ccrm/core';", 'export type S = ChatState;'].join(
      '\n',
    ),
  };

  it('findPrivateAngularApi trips on a ɵ symbol and stays silent on clean code', () => {
    expect(findPrivateAngularApi(violating)).toContain('ɵEffectScheduler');
    expect(findPrivateAngularApi(clean)).toEqual([]);
  });

  it('findNonBarrelImports trips on a deep import and stays silent on a barrel import', () => {
    expect(findNonBarrelImports(violating)).toEqual([
      '@dhaam-ccrm/core/messages/ticks.js',
      '@angular/core/rxjs-interop',
    ]);
    expect(findNonBarrelImports(clean)).toEqual([]);
  });

  it('findRxjsImports trips on both rxjs and the rxjs-interop bridge, and stays silent on clean code', () => {
    expect(findRxjsImports(violating)).toEqual(['@angular/core/rxjs-interop', 'rxjs/operators']);
    expect(findRxjsImports(clean)).toEqual([]);
  });

  it('ignores a specifier that only appears inside a comment', () => {
    const commentedOnly: SourceFile = {
      path: 'synthetic-comment.ts',
      code: ["// `toObservable(store.messages)` from '@angular/core/rxjs-interop' is a one-liner.", 'export const x = 1;'].join('\n'),
    };
    expect(findNonBarrelImports(commentedOnly)).toEqual([]);
    expect(findRxjsImports(commentedOnly)).toEqual([]);
  });
});
