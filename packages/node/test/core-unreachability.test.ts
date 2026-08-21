// §14 core unreachability — the other half of the mutual-isolation claim
// `packaging.test.ts` already makes for this package.
//
// `packaging.test.ts` proves NODE takes no dependency on any sibling SDK
// package, in either direction — by manifest and by import. That is one edge
// of a two-edge claim. `index.ts`'s own header states the other edge in
// words: "there is deliberately no dependency edge between [`@dhaam-ccrm/
// node`] and [`@dhaam-ccrm/core`] in either direction: that edge is how a
// secret key ends up in a client bundle". This file checks THAT edge, from
// here: that CORE — the browser package — declares and takes no dependency
// on `@dhaam-ccrm/node`, and that the commerce surface this package added
// (secret-key-only; recorded to `POST /contacts/commerce-events`) is
// unreachable from core's public entry point.
//
// Same mechanism as packaging.test.ts throughout: structural checks over a
// manifest and actual source text, not a review comment or a hope that
// nobody adds the edge later.
//
// Deliberately read-only, and deliberately NOT a module import of
// `@dhaam-ccrm/core`. Importing `core/src/index.ts` at runtime would pull
// its whole module graph into a test file compiled under THIS package's
// tsconfig — which drops the DOM lib on purpose (see `tsconfig.json`), while
// core legitimately references browser globals in its own isolated adapter
// (`storage/browser.ts`). That combination would fail to typecheck for
// reasons that have nothing to do with the claim this file is making. A text
// scan proves the same thing without that coupling.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = join(packageRoot, '..', 'core');

const coreManifest = JSON.parse(
  readFileSync(join(coreRoot, 'package.json'), 'utf8'),
) as Record<string, unknown>;

describe('sanity: this file is actually reading the @dhaam-ccrm/core sibling package', () => {
  it('resolved to the right package.json', () => {
    // Guards every assertion below this point: a wrong relative path here
    // (e.g. after a directory reshuffle) would make every check in this file
    // pass vacuously against a missing or unrelated manifest.
    expect(coreManifest['name']).toBe('@dhaam-ccrm/core');
  });
});

function allManifestDeps(manifest: Record<string, unknown>): Record<string, string> {
  return {
    ...((manifest['dependencies'] as Record<string, string>) ?? {}),
    ...((manifest['peerDependencies'] as Record<string, string>) ?? {}),
    ...((manifest['optionalDependencies'] as Record<string, string>) ?? {}),
    ...((manifest['devDependencies'] as Record<string, string>) ?? {}),
  };
}

describe('@dhaam-ccrm/core package manifest', () => {
  it('declares no dependency on @dhaam-ccrm/node specifically, in any manifest field', () => {
    expect(Object.keys(allManifestDeps(coreManifest))).not.toContain('@dhaam-ccrm/node');
  });

  it('declares no dependency on ANY sibling SDK package — the same claim packaging.test.ts makes for this package, checked from the other side of the edge', () => {
    const siblings = Object.keys(allManifestDeps(coreManifest)).filter((name) =>
      name.startsWith('@dhaam-ccrm/'),
    );
    expect(siblings).toEqual([]);
  });
});

describe('@dhaam-ccrm/core source imports', () => {
  // Recursive, unlike packaging.test.ts's flat readdirSync: core/src has
  // subdirectories (auth/, client/, connection/, ...) and this package's
  // src/ does not.
  //
  // `*.test.ts` is excluded on purpose, matching core's own convention
  // (`packages/core/test/invariants/source-scan.ts`'s `coreSourceFiles()`):
  // tests never ship in a bundle, and core's OWN tests legitimately
  // construct `dhk_`-shaped strings to prove `parsePublishableKey` and
  // `createChatClient` reject one
  // (`packages/core/test/invariants/no-secret-key-reachable.test.ts`).
  // Scanning test files here would flag that legitimate rejection code as if
  // it were the leak it exists to prevent.
  function walk(dir: string, out: string[]): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, out);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  const sourcePaths = walk(join(coreRoot, 'src'), []);
  const sources = sourcePaths.map((path) => readFileSync(path, 'utf8'));

  it('found the source files to check', () => {
    // Guards the guard, same as packaging.test.ts's own version of this
    // check: a walk that silently matched nothing would make every
    // assertion below vacuously pass.
    expect(sourcePaths.length).toBeGreaterThan(40);
  });

  it('imports nothing from @dhaam-ccrm/node', () => {
    for (const source of sources) {
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      const nodeImports = specifiers.filter(
        (s) => s === '@dhaam-ccrm/node' || s?.startsWith('@dhaam-ccrm/node/'),
      );
      expect(nodeImports).toEqual([]);
    }
  });

  it('contains no contiguous key literal a secret scanner would match — the same pattern packaging.test.ts bans in this package\'s own source', () => {
    // Catches an actual embedded/leaked key. Deliberately does NOT ban the
    // bare `dhk_` prefix by itself: `auth/keys.ts` legitimately names it —
    // it is how core recognises and REJECTS a secret key handed to it by
    // mistake (`SecretKeyInClientError`), which is the "structurally
    // impossible to reference" mechanism §14 asks for, not a violation of
    // it. What must never appear is a full, contiguous, scannable literal —
    // a key core could actually hold and present as a credential.
    const scannable = /(dhk|dhp|dhsk|dhpk|sk|pk)_(live|test)_[A-Za-z0-9_-]{20,}/;
    for (const source of sources) {
      expect(source).not.toMatch(scannable);
    }
  });

  it('never mentions the commerce route or its wire vocabulary anywhere in shipped source', () => {
    // Applied to raw source, comments included on purpose: a comment that
    // references the commerce route is still a reference to it, and this is
    // about what a browser-targeted package should have any reason to know
    // about, not merely what executes.
    for (const source of sources) {
      expect(source).not.toMatch(/commerce-events/i);
      expect(source).not.toMatch(/\bCommerceEvent\b/);
      expect(source).not.toMatch(/\bContactCart(Row|Status)?\b/);
      expect(source).not.toMatch(/\brecordCommerceEvent\b/);
      expect(source).not.toMatch(/\bbuildCommerceEventBody\b/);
    }
  });
});

describe("the commerce surface is unreachable from @dhaam-ccrm/core's public entry point", () => {
  const indexSource = readFileSync(join(coreRoot, 'src', 'index.ts'), 'utf8');

  /**
   * Every identifier actually re-exported from an `export { ... }` /
   * `export type { ... }` block in core's barrel — not merely mentioned in a
   * comment. Core's `index.ts` names `@dhaam-ccrm/node` and several of its
   * own internal concepts in prose (its own module header explains this
   * exact split), so a plain substring search over the whole file would trip
   * on the documentation, not the surface. Comments are stripped first so a
   * comment INSIDE an export block (core's barrel has several, documenting
   * individual re-exports) cannot itself be mistaken for an identifier.
   */
  function exportedIdentifiers(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const names: string[] = [];
    for (const match of withoutComments.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
      const body = match[1] ?? '';
      for (const raw of body.split(',')) {
        const name = raw.split(/\s+as\s+/)[0]?.trim();
        if (name) names.push(name);
      }
    }
    return names;
  }

  const exported = exportedIdentifiers(indexSource);

  it('found export blocks to check', () => {
    // Guards the guard: a regex that stopped matching (e.g. after index.ts
    // switched to `export * from`) would make the next assertion pass
    // vacuously.
    expect(exported.length).toBeGreaterThan(50);
  });

  it('does not export any node-only, secret-key-scoped API', () => {
    const forbidden = [
      // client.ts
      'ChatServerClient',
      'UserScopedClient',
      // commerce.ts — the surface this package added, and the reason this
      // file exists.
      'recordCommerceEvent',
      'buildCommerceEventBody',
      'InvalidCommerceEventError',
      'isRetryableContactsError',
      'CommerceEvent',
      'CommerceEventResult',
      'CommerceEventType',
      'CommerceCartItem',
      'ContactCartRow',
      'ContactCartStatus',
      // tokens.ts
      'mintAccessToken',
      'buildMintTokenBody',
      'InvalidMintRequestError',
      // keys.ts — the secret-key half; core's own auth/keys.ts is the
      // publishable-key equivalent and is a DIFFERENT module entirely.
      'parseSecretKey',
      'isSecretKey',
      'maskSecretKey',
      'secretKeyEnvironment',
      'InvalidSecretKeyError',
      'PublishableKeyAsSecretError',
      // http.ts
      'HttpClient',
      'BASE_PATH',
    ];
    const leaked = forbidden.filter((name) => exported.includes(name));
    expect(leaked).toEqual([]);
  });
});
