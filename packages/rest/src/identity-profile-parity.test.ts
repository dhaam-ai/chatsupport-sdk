// `IdentityProfile` (packages/core/src/identity/types.ts §3.1) and
// `RestIdentityProfile` (adapters.ts §3.3) must stay field-for-field
// identical BY HAND — CONTACT_IDENTIFY_CONTRACT.md §3.3 says so explicitly,
// because packages/rest has zero dependency on core (no-core-import.test.ts),
// so nothing compiles the two shapes against each other. The contract itself
// calls this "manual diff at PR review time... there is no automated check
// across the two packages by design."
//
// This closes that gap WITHOUT adding the forbidden dependency. It reads
// core's source file off disk as plain TEXT — no `import`, no module
// resolution, no devDependency, nothing that ships or changes this package's
// dependency graph. That is not a loophole: it is the same technique the
// repo's own CI "Every test file is typechecked" step (.github/workflows/
// ci.yml) already uses to compare every workspace's tsconfig against what
// vitest actually runs — reading a sibling package's file with node:fs is a
// build-time/test-time-only concern, unrelated to what @dhaam-ccrm/rest
// imports at runtime or declares as a dependency.
//
// Deliberately a text-shape comparison, not a semantic one: a change that
// reformats one interface without mirroring it in the other still fails
// this test, which is exactly the "someone touched this, look again" signal
// a manual diff exists to produce anyway — just automated so it can't be
// forgotten.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_IDENTITY_TYPES_PATH = resolve(HERE, '../../core/src/identity/types.ts');
const ADAPTERS_PATH = resolve(HERE, './adapters.ts');

function extractInterfaceBody(source: string, name: string): string {
  // `(?:export )?` — core's IdentityProfile is exported, rest's
  // RestIdentityProfile deliberately is not (adapters.ts's own comment: "the
  // package deliberately does not export" it). The non-greedy body capture
  // stops at the first ZERO-INDENT `}`, which is the interface's own close —
  // the nested `device` object's closing `};` is indented and never matches.
  const pattern = new RegExp(`(?:export )?interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const match = source.match(pattern);
  if (match === null) {
    throw new Error(`interface ${name} not found — did it get renamed or moved?`);
  }
  return match[1] ?? '';
}

/**
 * Field signatures: comments stripped, whitespace collapsed, split on
 * top-level `;` (brace-depth aware, so the nested `device: { ... }` object
 * survives as one field rather than being split apart), sorted so field
 * order is not itself treated as drift.
 */
function fieldSignatures(body: string): readonly string[] {
  const noBlockComments = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLineComments = noBlockComments.replace(/\/\/.*$/gm, '');
  const collapsed = noLineComments.replace(/\s+/g, ' ').trim();

  const fields: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of collapsed) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === ';' && depth === 0) {
      if (current.trim() !== '') fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim() !== '') fields.push(current.trim());
  return fields.sort();
}

describe('IdentityProfile (core) and RestIdentityProfile (rest) are kept identical by hand', () => {
  const coreSource = readFileSync(CORE_IDENTITY_TYPES_PATH, 'utf8');
  const restSource = readFileSync(ADAPTERS_PATH, 'utf8');

  const coreFields = fieldSignatures(extractInterfaceBody(coreSource, 'IdentityProfile'));
  const restFields = fieldSignatures(extractInterfaceBody(restSource, 'RestIdentityProfile'));

  it('declares the same fields, with the same optionality and the same types', () => {
    expect(restFields).toEqual(coreFields);
  });

  it('sanity: both interfaces were actually found and are non-trivial', () => {
    // 7 named fields today (name, email, phone, city, country, tags, device).
    // A regression to 0 would mean the regex stopped matching — silently
    // vacuous — rather than the interfaces having actually shrunk.
    expect(coreFields.length).toBeGreaterThanOrEqual(7);
    expect(restFields.length).toBeGreaterThanOrEqual(7);
  });

  it('the comparison is capable of failing — a deliberately drifted fixture is caught', () => {
    const drifted = fieldSignatures(
      'readonly name?: string; readonly email?: string; readonly extraField?: boolean;',
    );
    expect(drifted).not.toEqual(coreFields);
  });

  it('the extractor is brace-depth aware — the nested device object is one field, not several', () => {
    const withDevice = fieldSignatures(`
      readonly name?: string;
      readonly device?: {
        readonly deviceId: string;
        readonly deviceToken?: string;
      };
    `);
    expect(withDevice).toHaveLength(2);
    expect(withDevice.some((f) => f.includes('deviceId') && f.includes('deviceToken'))).toBe(true);
  });
});
