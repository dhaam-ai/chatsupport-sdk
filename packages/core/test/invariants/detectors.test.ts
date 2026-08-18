// Companion assertions for the invariant detectors.
//
// ── Why this file exists ─────────────────────────────────────────────────
//
// The guards in this directory scan a tree that is currently CLEAN. Every one
// of them therefore passes by asserting `[]`, and an `[]` is exactly what a
// broken detector also returns. A mistyped pattern, a lookbehind that never
// matches, a walker pointed at the wrong directory — all of them produce a
// permanently green test that will still be green in two years when someone
// adds `import React from 'react'` to core.
//
// So every detector is fed a KNOWN violation here and required to trip on it.
// These are the tests that give the `[]` assertions next door their meaning:
// if a detector is broken, it fails HERE, loudly, naming the case it missed.
//
// The negative cases matter as much as the positive ones. A detector that
// reports everything is as useless as one that reports nothing — it gets
// switched off at the first false alarm.

import { describe, expect, it } from 'vitest';

import {
  coreSourceFiles,
  findBareImports,
  findDeclaredRuntimeDependencies,
  findFrameworkDependencies,
  findFrameworkImports,
  findModuleSpecifiers,
  findNonPortableGlobals,
  stripComments,
  stripCommentsAndStrings,
  type SourceFile,
} from './source-scan.js';

/** Builds a synthetic file for a detector to chew on. */
function file(path: string, code: string): SourceFile {
  return { path, code };
}

describe('stripCommentsAndStrings (the primitive every source guard rests on)', () => {
  it('erases a global named only in a line comment', () => {
    const stripped = stripCommentsAndStrings('const a = 1; // reads window here\n');
    expect(stripped).not.toContain('window');
    expect(stripped).toContain('const a = 1;');
  });

  it('erases a global named only in a block comment', () => {
    const stripped = stripCommentsAndStrings('/* touches document at import */ const a = 1;');
    expect(stripped).not.toContain('document');
    expect(stripped).toContain('const a = 1;');
  });

  it('erases a global named only inside a string literal', () => {
    const stripped = stripCommentsAndStrings(`const msg = 'localStorage is unavailable';`);
    expect(stripped).not.toContain('localStorage');
  });

  it('does NOT erase code inside a ${} interpolation — a DOM read there is still a DOM read', () => {
    const stripped = stripCommentsAndStrings('const t = `title: ${document.title}`;');
    expect(stripped).toContain('document.title');
    // ...while the surrounding literal text is still gone.
    expect(stripped).not.toContain('title:');
  });

  it('preserves line numbers so a violation is reported at the line it is on', () => {
    const source = ['// window', '/* document', '   more */', 'const x = window;'].join('\n');
    const stripped = stripCommentsAndStrings(source);
    expect(stripped.split('\n')).toHaveLength(4);
    expect(stripped.split('\n')[3]).toContain('window');
  });

  it('does not mistake the // inside a URL string for a comment', () => {
    const stripped = stripComments(`const u = 'https://example.com/x'; const y = window;`);
    expect(stripped).toContain('window');
  });
});

describe('findNonPortableGlobals trips on a known violation', () => {
  it('catches a bare `window` read', () => {
    const found = findNonPortableGlobals([file('src/a.ts', 'const w = window.innerWidth;')]);
    expect(found.map((v) => v.detail)).toEqual(['window']);
  });

  it('catches `document`, `sessionStorage`, `navigator`, and `XMLHttpRequest`', () => {
    const found = findNonPortableGlobals([
      file(
        'src/a.ts',
        [
          'document.title = "x";',
          'sessionStorage.clear();',
          'navigator.sendBeacon("/x");',
          'new XMLHttpRequest();',
        ].join('\n'),
      ),
    ]);
    expect(found.map((v) => v.detail).sort()).toEqual([
      'XMLHttpRequest',
      'document',
      'navigator',
      'sessionStorage',
    ]);
  });

  it('catches a DOM read hidden inside a template interpolation', () => {
    const found = findNonPortableGlobals([file('src/a.ts', 'const s = `${document.title}`;')]);
    expect(found.map((v) => v.detail)).toEqual(['document']);
  });

  it('reports the line the violation is actually on', () => {
    const found = findNonPortableGlobals([
      file('src/a.ts', ['// a comment', '', 'const w = window;'].join('\n')),
    ]);
    expect(found[0]?.line).toBe(3);
  });

  it('does NOT fire on a property that merely shares the name', () => {
    const found = findNonPortableGlobals([
      file('src/a.ts', 'const d = frame.document; const n = opts.navigator;'),
    ]);
    expect(found).toEqual([]);
  });

  it('does NOT fire on a global named only in prose or an error message', () => {
    const found = findNonPortableGlobals([
      file(
        'src/a.ts',
        ['// This module never touches window or document.', `throw new Error('no localStorage');`].join(
          '\n',
        ),
      ),
    ]);
    expect(found).toEqual([]);
  });

  describe('the storage/browser.ts exemption is narrow', () => {
    it('lets storage/browser.ts read localStorage', () => {
      const found = findNonPortableGlobals([
        file('src/storage/browser.ts', 'const { localStorage } = globalThis as never;'),
      ]);
      expect(found).toEqual([]);
    });

    it('still refuses `window` INSIDE storage/browser.ts — the exemption is per-global, not a blanket pass', () => {
      const found = findNonPortableGlobals([
        file('src/storage/browser.ts', 'const w = window.localStorage;'),
      ]);
      expect(found.map((v) => v.detail)).toEqual(['window']);
    });

    it('still refuses `localStorage` in any OTHER file — the exemption is per-path', () => {
      const found = findNonPortableGlobals([
        file('src/queue/persistence.ts', 'const s = localStorage.getItem("k");'),
      ]);
      expect(found.map((v) => v.detail)).toEqual(['localStorage']);
    });
  });
});

describe('findModuleSpecifiers trips on every import form a bundler follows', () => {
  it.each([
    ['default import', `import React from 'react';`, 'react'],
    ['named import', `import { useState } from 'react';`, 'react'],
    ['namespace import', `import * as Vue from 'vue';`, 'vue'],
    ['type-only import', `import type { FC } from 'react';`, 'react'],
    ['side-effect import', `import 'socket.io-client';`, 'socket.io-client'],
    ['re-export', `export { useChat } from 'react';`, 'react'],
    ['star re-export', `export * from 'preact';`, 'preact'],
    ['dynamic import', `const m = await import('svelte');`, 'svelte'],
    ['require', `const io = require('socket.io-client');`, 'socket.io-client'],
  ])('finds the specifier in a %s', (_label, code, expected) => {
    const found = findModuleSpecifiers(file('src/a.ts', code));
    expect(found.map((f) => f.specifier)).toContain(expected);
  });

  it('finds a specifier in a multi-line import block', () => {
    const found = findModuleSpecifiers(
      file('src/a.ts', ['import {', '  a,', '  type B,', "} from 'react-dom';"].join('\n')),
    );
    expect(found.map((f) => f.specifier)).toEqual(['react-dom']);
  });

  it('does NOT count a commented-out import', () => {
    const found = findModuleSpecifiers(
      file('src/a.ts', [`// import React from 'react';`, `import { a } from './b.js';`].join('\n')),
    );
    expect(found.map((f) => f.specifier)).toEqual(['./b.js']);
  });
});

describe('findFrameworkImports trips on a known violation', () => {
  it('catches a direct React import', () => {
    const found = findFrameworkImports([file('src/a.ts', `import React from 'react';`)]);
    expect(found.map((v) => v.detail)).toEqual(['react']);
  });

  it('catches a DEEP import, which a plain equality check on the specifier would miss', () => {
    const found = findFrameworkImports([
      file('src/a.ts', `import { renderToString } from 'react-dom/server';`),
    ]);
    expect(found.map((v) => v.detail)).toEqual(['react-dom/server']);
  });

  it('catches socket.io-client — the dependency v1 shipped and core must not', () => {
    const found = findFrameworkImports([file('src/a.ts', `import { io } from 'socket.io-client';`)]);
    expect(found.map((v) => v.detail)).toEqual(['socket.io-client']);
  });

  it('does NOT fire on a relative import', () => {
    const found = findFrameworkImports([file('src/a.ts', `import { x } from './react.js';`)]);
    expect(found).toEqual([]);
  });
});

describe('findBareImports trips on a known violation', () => {
  it('catches a package the framework denylist does not name — the transitive-dependency case', () => {
    const found = findBareImports([file('src/a.ts', `import { z } from 'zod';`)]);
    expect(found.map((v) => v.detail)).toEqual(['zod']);
  });

  it('catches a node: builtin, which no browser or React Native engine provides', () => {
    const found = findBareImports([file('src/a.ts', `import { readFileSync } from 'node:fs';`)]);
    expect(found.map((v) => v.detail)).toEqual(['node:fs']);
  });

  it('does NOT fire on relative imports', () => {
    const found = findBareImports([
      file('src/a.ts', [`import { a } from './b.js';`, `import { c } from '../d/e.js';`].join('\n')),
    ]);
    expect(found).toEqual([]);
  });
});

describe('findDeclaredRuntimeDependencies trips on a known violation', () => {
  it('catches a runtime dependency', () => {
    const found = findDeclaredRuntimeDependencies({ dependencies: { 'socket.io-client': '^4.7.2' } });
    expect(found.map((v) => v.detail)).toEqual(['dependencies.socket.io-client']);
  });

  it('catches a peerDependency — the field v1 used to declare React through', () => {
    const found = findDeclaredRuntimeDependencies({ peerDependencies: { react: '>=17.0.0' } });
    expect(found.map((v) => v.detail)).toEqual(['peerDependencies.react']);
  });

  it('catches an optionalDependency', () => {
    const found = findDeclaredRuntimeDependencies({ optionalDependencies: { vue: '^3' } });
    expect(found.map((v) => v.detail)).toEqual(['optionalDependencies.vue']);
  });

  it('does NOT fire on devDependencies, which never reach a consumer install', () => {
    expect(findDeclaredRuntimeDependencies({ devDependencies: { typescript: '^5' } })).toEqual([]);
  });

  it('does NOT fire on a manifest with empty dependency objects', () => {
    expect(findDeclaredRuntimeDependencies({ dependencies: {}, peerDependencies: {} })).toEqual([]);
  });
});

describe('findFrameworkDependencies trips on a known violation', () => {
  it('catches React even in devDependencies, where it would not ship but would signal drift', () => {
    const found = findFrameworkDependencies({ devDependencies: { react: '^18.2.0' } });
    expect(found.map((v) => v.detail)).toEqual(['devDependencies.react']);
  });

  it('does NOT fire on a non-framework devDependency', () => {
    expect(findFrameworkDependencies({ devDependencies: { tsup: '^8' } })).toEqual([]);
  });
});

describe('coreSourceFiles points at the real tree (a walker aimed at nothing scans nothing)', () => {
  const files = coreSourceFiles();

  it('finds a substantial number of shipped source files', () => {
    // If the walker were pointed at a non-existent directory it would throw;
    // if it were pointed at an empty one, every guard in this directory would
    // vacuously pass. This is the assertion that rules that out.
    expect(files.length).toBeGreaterThan(40);
  });

  it('includes known landmark files, by the exact paths the exemption map keys on', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/storage/browser.ts');
    expect(paths).toContain('src/auth/keys.ts');
    expect(paths).toContain('src/transport/logger.ts');
    expect(paths).toContain('src/connection/controller.ts');
  });

  it('excludes test files, which are allowed to fake globals and import vitest', () => {
    expect(files.filter((f) => f.path.endsWith('.test.ts'))).toEqual([]);
  });

  it('actually read the file contents', () => {
    const index = files.find((f) => f.path === 'src/index.ts');
    expect(index?.code.length).toBeGreaterThan(0);
  });
});
