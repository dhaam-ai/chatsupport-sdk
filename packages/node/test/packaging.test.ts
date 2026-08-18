// The package's Node-only guarantees are structural, not documentary — so
// they are asserted here rather than trusted to review.
//
// §14 requires that `dhsk_` be impossible to reach from a browser-targeted
// package. Every check below is one of the mechanisms that makes that true,
// and each has a plausible way of being undone by a well-meaning edit: someone
// adds a `browser` field to "fix" a bundler warning, someone imports a type
// from core to remove a duplicated interface, someone flips a tsup default
// back. Each would silently reopen the path this package exists to close.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
) as Record<string, unknown>;

describe('package manifest', () => {
  it('declares no browser field', () => {
    // A `browser` field is a bundler's invitation to include this package in a
    // client build. Its absence is the first thing that stops that.
    expect('browser' in manifest).toBe(false);
  });

  it('requires Node 18 or newer', () => {
    // 18 is the floor for global `fetch`. Declaring it means a package manager
    // warns on an older runtime rather than failing at the first request with
    // "fetch is not defined".
    expect(manifest['engines']).toEqual({ node: '>=18.0.0' });
  });

  it('has zero runtime dependencies', () => {
    // A supply-chain surface on the secret-key package is worth avoiding: every
    // transitive dependency is code running in the same process as the key.
    expect(manifest['dependencies']).toBeUndefined();
  });

  it('takes no dependency on any sibling SDK package, in either direction', () => {
    // The edge from the secret-key holder to a browser package is exactly how
    // a secret key ends up in a bundle. Duplicating a few type declarations is
    // the cheaper mistake.
    const allDeps = {
      ...((manifest['dependencies'] as Record<string, string>) ?? {}),
      ...((manifest['peerDependencies'] as Record<string, string>) ?? {}),
      ...((manifest['devDependencies'] as Record<string, string>) ?? {}),
    };
    const siblings = Object.keys(allDeps).filter((name) => name.startsWith('@dhaam-ccrm/'));
    expect(siblings).toEqual([]);
  });
});

describe('source imports', () => {
  const sources = [
    'client.ts',
    'errors.ts',
    'http.ts',
    'index.ts',
    'keys.ts',
    'pagination.ts',
    'tokens.ts',
    'types.ts',
    'webhooks.ts',
  ].map((name) => readFileSync(join(packageRoot, 'src', name), 'utf8'));

  it('imports nothing from a sibling SDK package', () => {
    for (const source of sources) {
      // Comments naming the packages are fine and deliberate — the ban is on
      // an actual module specifier.
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      expect(specifiers.filter((s) => s?.startsWith('@dhaam-ccrm/'))).toEqual([]);
    }
  });

  it('imports node builtins with the node: prefix', () => {
    for (const source of sources) {
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      const builtins = specifiers.filter((s) => !s.startsWith('.'));
      for (const builtin of builtins) {
        expect(builtin.startsWith('node:')).toBe(true);
      }
    }
  });

  it('contains no contiguous key literal a secret scanner would match', () => {
    // GitHub push protection blocked a push to this repo on two synthetic
    // fixtures. A full key written inline matches the pattern whether or not
    // the bytes are real — see test/fixtures.ts for how keys are assembled.
    const scannable = /(dhsk|dhpk|sk|pk)_(live|test)_[A-Za-z0-9_-]{20,}/;
    for (const source of sources) {
      expect(source).not.toMatch(scannable);
    }
  });
});
