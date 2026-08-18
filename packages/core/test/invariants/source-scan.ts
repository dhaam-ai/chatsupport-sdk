// Shared scanning primitives for the §15 invariant guards.
//
// These are deliberately plain functions over `(path, code)` pairs rather than
// helpers that read the filesystem themselves. That is what makes the
// companion assertions in `detectors.test.ts` possible: a detector can be
// handed a synthetic file containing a KNOWN violation and asked whether it
// trips. A detector that only ever runs against the real (clean) tree is a
// permanently green test — it passes identically whether its pattern is
// right, wrong, or matches nothing at all.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One source file, as the detectors see it. */
export interface SourceFile {
  /** Path relative to `packages/core/`, POSIX-separated. e.g. `src/auth/keys.ts`. */
  readonly path: string;
  readonly code: string;
}

/** A detector hit. `detail` names what was found, `path`/`line` where. */
export interface Violation {
  readonly path: string;
  readonly line: number;
  readonly detail: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/core/`. */
export const CORE_ROOT = resolve(HERE, '..', '..');

/** `packages/core/src/`. */
export const CORE_SRC = join(CORE_ROOT, 'src');

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every shipped `.ts` file under `packages/core/src`, excluding `*.test.ts`.
 *
 * Tests are excluded because they never ship: they run in vitest's node
 * harness, import `vitest`, and may legitimately fake a DOM global. The
 * invariants here are about the code that reaches a consumer's bundle.
 */
export function coreSourceFiles(): SourceFile[] {
  return walk(CORE_SRC, [])
    .filter((full) => !full.endsWith('.test.ts'))
    .map((full) => ({
      path: relative(CORE_ROOT, full).split(sep).join('/'),
      code: readFileSync(full, 'utf8'),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Blanks out comments and string/template-literal *text*, preserving newlines
 * and character offsets so reported line numbers stay accurate.
 *
 * Why this exists: `storage/browser.ts` says the word "localStorage" in eight
 * prose sentences and error messages. A raw text search cannot tell those
 * apart from the one line that actually reads the global, so it would have to
 * be loosened until it caught nothing.
 *
 * `${...}` interpolations are deliberately kept as code — a
 * `` `${document.title}` `` is a real DOM read wearing a string's clothes, and
 * blanking template bodies wholesale would hide it.
 */
export function stripCommentsAndStrings(source: string): string {
  return scan(source, false);
}

/**
 * Blanks comments only, leaving string literals intact.
 *
 * Import specifiers *are* string literals, so the module-specifier detectors
 * cannot use {@link stripCommentsAndStrings}. They still must not see a
 * commented-out `import ... from 'react'`, and they must not mistake the `//`
 * inside a `'https://…'` literal for the start of a comment — which is why
 * this shares the same scanner rather than being a regex.
 */
export function stripComments(source: string): string {
  return scan(source, true);
}

function scan(source: string, keepStrings: boolean): string {
  const out: string[] = [];
  const braceDepths: number[] = [];
  let mode: 'code' | 'template' = 'code';
  let i = 0;
  const n = source.length;

  /** Comment characters. Always erased, in both modes. */
  const blank = (ch: string): void => {
    out.push(ch === '\n' ? '\n' : ' ');
  };

  /** String / template-literal characters. Erased only when stripping strings. */
  const text = (ch: string): void => {
    out.push(keepStrings ? ch : ch === '\n' ? '\n' : ' ');
  };

  while (i < n) {
    const c = source[i] ?? '';
    const d = source[i + 1] ?? '';

    if (mode === 'template') {
      if (c === '\\') {
        text(c);
        text(d);
        i += 2;
        continue;
      }
      if (c === '`') {
        text(c);
        i += 1;
        mode = 'code';
        continue;
      }
      if (c === '$' && d === '{') {
        text(c);
        text(d);
        i += 2;
        braceDepths.push(0);
        mode = 'code';
        continue;
      }
      text(c);
      i += 1;
      continue;
    }

    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') {
        blank(source[i] ?? '');
        i += 1;
      }
      continue;
    }

    if (c === '/' && d === '*') {
      blank(c);
      blank(d);
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        blank(source[i] ?? '');
        i += 1;
      }
      if (i < n) {
        blank('*');
        blank('/');
        i += 2;
      }
      continue;
    }

    if (c === "'" || c === '"') {
      text(c);
      i += 1;
      while (i < n) {
        const s = source[i] ?? '';
        if (s === '\\') {
          text(s);
          text(source[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (s === c) {
          text(s);
          i += 1;
          break;
        }
        text(s);
        i += 1;
      }
      continue;
    }

    if (c === '`') {
      text(c);
      i += 1;
      mode = 'template';
      continue;
    }

    const top = braceDepths.length - 1;
    if (top >= 0) {
      const depth = braceDepths[top] ?? 0;
      if (c === '{') {
        braceDepths[top] = depth + 1;
      } else if (c === '}') {
        if (depth === 0) {
          braceDepths.pop();
          text(c);
          i += 1;
          mode = 'template';
          continue;
        }
        braceDepths[top] = depth - 1;
      }
    }

    out.push(c);
    i += 1;
  }

  return out.join('');
}

/** 1-based line number of `index` within `source`. */
function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Detector: platform globals
// ---------------------------------------------------------------------------

/**
 * Globals that do not exist in all three runtimes §15 names (browser, Node
 * harness, React Native JS engine). `globalThis` is deliberately absent: it
 * exists everywhere, and reaching for a capability *through* it is the
 * portable pattern core already uses (`transport/socket.ts`,
 * `transport/logger.ts`).
 */
export const NON_PORTABLE_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'XMLHttpRequest',
  'HTMLElement',
] as const;

/**
 * Files allowed to name a given global, and nothing more.
 *
 * §15 carves out "clearly isolated, optional platform-adapter files".
 * `storage/browser.ts` is the whole of that carve-out today, and it is
 * scoped to `localStorage` alone — the file itself documents that it "never
 * references `window` or `document` at all", so this encodes that promise
 * rather than exempting the file wholesale.
 */
const GLOBAL_EXEMPTIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['src/storage/browser.ts', ['localStorage']],
]);

/**
 * Reports every reference to a non-portable platform global in shipped source.
 *
 * Member accesses (`info.document`, `opts.navigator`) are excluded by the
 * lookbehind, so a domain field that happens to share a name with a DOM global
 * does not produce a false alarm.
 */
export function findNonPortableGlobals(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const code = stripCommentsAndStrings(file.code);
    const exempt = GLOBAL_EXEMPTIONS.get(file.path) ?? [];

    for (const global of NON_PORTABLE_GLOBALS) {
      if (exempt.includes(global)) continue;

      const pattern = new RegExp(`(?<![.\\w$'"])${global}(?![\\w$])`, 'g');
      for (const match of code.matchAll(pattern)) {
        violations.push({
          path: file.path,
          line: lineOf(code, match.index),
          detail: global,
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Detector: module specifiers
// ---------------------------------------------------------------------------

/**
 * Every module specifier a file imports, re-exports, or `require`s.
 *
 * Covers the four forms that can pull a package in: `import ... from 'x'`,
 * `export ... from 'x'`, bare side-effect `import 'x'`, and the dynamic
 * `import('x')` / `require('x')` calls a bundler still follows.
 */
export function findModuleSpecifiers(file: SourceFile): { specifier: string; line: number }[] {
  // Comments blanked, strings kept: a commented-out `import 'react'` is not an
  // import, but the specifier we are looking for is itself a string literal.
  const code = stripComments(file.code);
  const found: { specifier: string; line: number }[] = [];

  const patterns = [
    /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      found.push({ specifier, line: lineOf(code, match.index) });
    }
  }

  return found;
}

/** Package names core must never reach, directly or through a re-export. */
export const FRAMEWORK_AND_UI_PACKAGES = [
  'react',
  'react-dom',
  'react-native',
  'vue',
  '@vue/runtime-core',
  '@angular/core',
  'svelte',
  'preact',
  'solid-js',
  'socket.io-client',
  'socket.io',
] as const;

function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0] ?? specifier;
}

/**
 * Reports any import of a framework, UI, or transport-library package.
 *
 * Matched on the *package* rather than the raw specifier so a deep import
 * (`react-dom/server`, `socket.io-client/dist/socket`) is caught too.
 */
export function findFrameworkImports(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  const forbidden = new Set<string>(FRAMEWORK_AND_UI_PACKAGES);

  for (const file of files) {
    for (const { specifier, line } of findModuleSpecifiers(file)) {
      if (specifier.startsWith('.')) continue;
      if (forbidden.has(packageOf(specifier))) {
        violations.push({ path: file.path, line, detail: specifier });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Detector: package manifest
// ---------------------------------------------------------------------------

/** Manifest fields that put a package into a consumer's install tree. */
export const RUNTIME_DEPENDENCY_FIELDS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/**
 * Reports every package declared in a manifest field that reaches consumers.
 *
 * §15's claim is absolute — core declares none — so this reports *any* entry
 * rather than filtering against a denylist. A denylist here would pass the day
 * someone adds a UI package it has never heard of.
 */
export function findDeclaredRuntimeDependencies(manifest: unknown): Violation[] {
  const violations: Violation[] = [];
  if (typeof manifest !== 'object' || manifest === null) return violations;
  const record = manifest as Record<string, unknown>;

  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    const value = record[field];
    if (typeof value !== 'object' || value === null) continue;
    for (const name of Object.keys(value as Record<string, unknown>)) {
      violations.push({ path: 'package.json', line: 0, detail: `${field}.${name}` });
    }
  }

  return violations;
}

/**
 * Reports a framework/UI package declared in ANY manifest field, devDeps
 * included.
 *
 * Separate from the rule above because it survives a future decision to allow
 * core one runtime dependency: whatever else changes, React must not appear.
 * A devDependency does not ship, but core has no build or test need for one,
 * so its arrival means someone is about to import it.
 */
export function findFrameworkDependencies(manifest: unknown): Violation[] {
  const violations: Violation[] = [];
  if (typeof manifest !== 'object' || manifest === null) return violations;
  const record = manifest as Record<string, unknown>;
  const forbidden = new Set<string>(FRAMEWORK_AND_UI_PACKAGES);

  for (const [field, value] of Object.entries(record)) {
    if (!field.toLowerCase().endsWith('dependencies')) continue;
    if (typeof value !== 'object' || value === null) continue;
    for (const name of Object.keys(value as Record<string, unknown>)) {
      if (forbidden.has(name)) {
        violations.push({ path: 'package.json', line: 0, detail: `${field}.${name}` });
      }
    }
  }

  return violations;
}

/**
 * Reports any non-relative import at all.
 *
 * The structural half of guard 1, and the reason a *transitive* framework
 * dependency cannot hide: core reaches zero packages, so there is no
 * dependency edge for React to arrive along. Catches what the denylist above
 * cannot — a wrapper package, a fork, or next year's framework.
 *
 * `node:*` is forbidden by the same rule and for the same reason: §15 requires
 * core to run unmodified in a browser and a React Native JS engine, neither of
 * which has `node:fs`.
 */
export function findBareImports(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    for (const { specifier, line } of findModuleSpecifiers(file)) {
      if (specifier.startsWith('.')) continue;
      violations.push({ path: file.path, line, detail: specifier });
    }
  }

  return violations;
}
