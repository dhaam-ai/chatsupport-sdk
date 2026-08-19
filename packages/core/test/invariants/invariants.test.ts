// Task T14 — structural guard tests. These enforce, by scanning the actual
// package contents rather than by inspection, the two hard invariants
// declared at the top of src/index.ts: zero framework/DOM dependency, and no
// secret key ever becomes reachable from this package.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..', '..');
const srcRoot = join(packageRoot, 'src');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const srcFiles = listFiles(srcRoot).filter((f) => !f.endsWith('.test.ts'));

describe('T14 invariant guards', () => {
  it('declares no framework/UI runtime dependency in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const banned = ['react', 'react-dom', 'vue', '@angular/core', 'svelte', 'preact', 'jquery'];
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const name of banned) {
      expect(deps, `package.json dependencies must not include ${name}`).not.toContain(name);
    }
  });

  it('never imports a framework package from src', () => {
    const bannedImport = /from\s+['"](react|react-dom|vue|@angular\/core|svelte|preact|jquery)(\/|['"])/;
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      expect(bannedImport.test(content), `${relative(packageRoot, file)} imports a banned framework package`).toBe(false);
    }
  });

  it('never references `window` or `document` outside an isolated platform adapter', () => {
    // No platform adapter exists yet (see src/index.ts header) — so this is
    // currently a blanket ban. If one is added later, its file should be
    // named to make this exemption obvious and this test updated to allow it.
    const bannedGlobal = /\b(window|document)\s*\./;
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      expect(bannedGlobal.test(content), `${relative(packageRoot, file)} references window/document directly`).toBe(false);
    }
  });

  it('never contains a hardcoded secret-key-shaped literal', () => {
    // Publishable keys (pk_...) are meant to be public and are fine. Secret
    // keys (sk_...) must never be embedded, logged, or otherwise reachable
    // from a browser-shipped package — this package only ever handles
    // publishableKey + short-lived tokens/guestId, never a tenant secret.
    const secretKeyShaped = /['"`]sk_[A-Za-z0-9]{8,}['"`]/;
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      expect(secretKeyShaped.test(content), `${relative(packageRoot, file)} contains a hardcoded secret-key-shaped literal`).toBe(false);
    }
  });

  it('never logs a raw token or guestId value by name', () => {
    // Loose heuristic guard: flags the common mistake of passing the actual
    // credential value into a log call, e.g. log('debug', 'token', token).
    // Logging *that* a refresh happened is fine; logging the token is not.
    const loggingRawCredential = /log\([^)]*\b(token|accessToken|guestId)\b\s*[,)]/;
    for (const file of srcFiles) {
      if (!file.endsWith('client.ts')) continue; // only client.ts calls the injected logger
      const content = readFileSync(file, 'utf8');
      const suspiciousLines = content
        .split('\n')
        .filter((line: string) => loggingRawCredential.test(line) && !line.trim().startsWith('//'));
      expect(suspiciousLines, `${relative(packageRoot, file)} appears to log a raw credential value`).toEqual([]);
    }
  });
});
