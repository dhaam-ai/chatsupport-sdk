// Conformance checklist (CONTACT_IDENTIFY_CONTRACT.md §5, SDK-side):
// "packages/rest/package.json has no @dhaam-ccrm/core dependency, and
// adapters.ts's new factory imports nothing from core — only from
// ./client.js and ./envelope.js, matching the other four factories."
//
// This was previously true by inspection only — nothing in the test suite
// asserted it. A future factory (or a "just this once" import to borrow a
// type) could add the dependency this package's whole design exists to
// avoid (adapters.ts's own header comment; CONTACT_IDENTIFY_CONTRACT.md §3.3)
// without any test noticing. This file is the regression guard.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_PATH = resolve(HERE, '../package.json');

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function sourceFiles(): readonly string[] {
  return readdirSync(HERE).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
}

describe('packages/rest has zero dependency on @dhaam-ccrm/core', () => {
  it('declares no @dhaam-ccrm/core dependency in package.json, under any dependency field', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as Record<string, unknown>;

    for (const field of DEPENDENCY_FIELDS) {
      const value = pkg[field];
      if (value !== undefined && typeof value === 'object' && value !== null) {
        expect(Object.keys(value as Record<string, unknown>)).not.toContain('@dhaam-ccrm/core');
      }
    }
  });

  it('imports nothing from @dhaam-ccrm/core anywhere in src/ — not adapters.ts, not any sibling', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const text = readFileSync(resolve(HERE, file), 'utf8');
      const importsCore =
        /from\s+['"]@dhaam-ccrm\/core['"]/.test(text) ||
        /require\(\s*['"]@dhaam-ccrm\/core['"]\s*\)/.test(text) ||
        /import\(\s*['"]@dhaam-ccrm\/core['"]\s*\)/.test(text);
      if (importsCore) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it('sanity: the scan actually looked at real files, including adapters.ts', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain('adapters.ts');
  });

  it('the import-detector is capable of failing — a synthetic offending line is caught', () => {
    const offending = `import type { IdentityProfile } from '@dhaam-ccrm/core';\n`;
    expect(/from\s+['"]@dhaam-ccrm\/core['"]/.test(offending)).toBe(true);
  });
});
