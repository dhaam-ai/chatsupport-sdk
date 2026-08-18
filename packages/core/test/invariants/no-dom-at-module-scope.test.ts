// GUARD 2 — PRD §15: core touches no DOM global at module scope.
//
// §15 requires core to run unmodified in a browser, a Node harness, and a
// React Native JS engine. The sharp edge of that is IMPORT TIME: a `window`,
// `document`, or `localStorage` reference evaluated while a module is being
// loaded breaks server-side rendering the instant core is imported on a
// server — before the app calls a single core function, and regardless of
// whether the feature that needs the DOM is ever used. `useEffect` guards and
// `typeof window` checks inside functions do not help, because the module
// body already ran.
//
// ── Why this guard is a runtime harness and not only a text search ───────
//
// "At module scope" is a question about *evaluation order*, and no regex
// answers it: `window.x` inside a function body is fine, the identical text at
// the top level is a production outage. Static analysis would have to model
// scope to tell them apart, and would still miss an indirect read through a
// helper called during initialisation.
//
// So the load-bearing assertion here does not read source at all. It replaces
// each platform global with a property whose getter THROWS AND RECORDS, then
// imports core and checks the recording is empty. Any read at import time —
// direct, indirect, through a helper, through a `?.`, however it is spelled —
// trips it, because the check is the actual runtime behaviour rather than a
// description of it.
//
// The text search is kept as a second, narrower net (see the end of this
// file): it catches a *lazy* `window` reference, which this harness cannot,
// and which still fails on React Native where there is no `window` to find.
//
// ── The BrowserStorageAdapter exception, encoded narrowly ────────────────
//
// §15 carves out "clearly isolated, optional platform-adapter files" and
// `storage/browser.ts` is the whole of that carve-out. It is NOT exempted from
// this harness. It is required to pass it — importing the file must touch
// nothing — and then separately required to reach for `localStorage` when a
// method actually runs. Those two assertions together are what "isolated" and
// "probes lazily" mean operationally, and they would both fail if someone
// hoisted the probe to module scope, which a blanket file exemption would
// silently permit.

import { describe, expect, it, vi } from 'vitest';

import { coreSourceFiles, findNonPortableGlobals, NON_PORTABLE_GLOBALS } from './source-scan.js';

/** A global reinstated exactly as it was, whether it existed before or not. */
interface PoisonedGlobals {
  /** Names read or written while the poison was installed, in order. */
  readonly touched: readonly string[];
  restore(): void;
}

/**
 * Replaces every platform global with a throwing, recording accessor.
 *
 * Throwing matters as much as recording: a module that reads `window` at import
 * time should fail the test even if it swallows the error in a `try/catch`,
 * because the recording still shows the read. Recording matters because a
 * module that guards with `try/catch` would otherwise import cleanly and look
 * compliant while still being the thing SSR trips over.
 */
function poisonPlatformGlobals(): PoisonedGlobals {
  const touched: string[] = [];
  const saved = new Map<string, PropertyDescriptor | undefined>();

  for (const name of NON_PORTABLE_GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        touched.push(name);
        throw new Error(`\`${name}\` was read`);
      },
      set() {
        touched.push(name);
        throw new Error(`\`${name}\` was assigned`);
      },
    });
  }

  return {
    touched,
    restore() {
      for (const [name, descriptor] of saved) {
        if (descriptor === undefined) {
          Reflect.deleteProperty(globalThis, name);
        } else {
          Object.defineProperty(globalThis, name, descriptor);
        }
      }
    },
  };
}

interface ImportOutcome {
  readonly touched: readonly string[];
  readonly threw: string | null;
}

/**
 * Imports `specifier` with the platform globals poisoned.
 *
 * `vi.resetModules()` first, so a module already evaluated by an earlier test
 * is re-executed rather than served from cache — a cached module runs no body,
 * touches no global, and would pass this vacuously.
 */
async function importUnderPoison(specifier: string): Promise<ImportOutcome> {
  vi.resetModules();
  const poison = poisonPlatformGlobals();
  let threw: string | null = null;

  try {
    await import(/* @vite-ignore */ specifier);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  } finally {
    poison.restore();
  }

  return { touched: [...poison.touched], threw };
}

describe('the poisoned-global harness itself works', () => {
  // Without these two, everything below is a test that passes because nothing
  // was ever detected — the exact failure mode this task exists to prevent.

  it('CATCHES a fixture that reads a DOM global at module scope', async () => {
    const outcome = await importUnderPoison('./fixtures/eager-dom-read.js');
    expect(outcome.touched).toContain('window');
    expect(outcome.threw).not.toBeNull();
  });

  it('ALLOWS a fixture that reads the same global lazily, inside a function', async () => {
    const outcome = await importUnderPoison('./fixtures/lazy-dom-read.js');
    expect(outcome).toEqual({ touched: [], threw: null });
  });

  it('restores the globals afterwards, so it cannot corrupt sibling tests', () => {
    // Not "they are all absent afterwards" — modern Node defines a real
    // `globalThis.navigator`, so the harness must put back exactly what it
    // found rather than leaving a hole. Descriptors are compared because that
    // is what a later test would actually observe.
    const before = NON_PORTABLE_GLOBALS.map((name) =>
      Object.getOwnPropertyDescriptor(globalThis, name),
    );

    const poison = poisonPlatformGlobals();
    poison.restore();

    const after = NON_PORTABLE_GLOBALS.map((name) =>
      Object.getOwnPropertyDescriptor(globalThis, name),
    );

    expect(after).toEqual(before);
  });

  it('poisons even a global that already exists natively in this runtime', () => {
    // `navigator` is present in Node. If `defineProperty` silently failed to
    // shadow a pre-existing global, the harness would be blind to exactly the
    // reads most likely to succeed by accident.
    const poison = poisonPlatformGlobals();
    try {
      expect(() => (globalThis as { navigator?: unknown }).navigator).toThrow();
      expect(poison.touched).toContain('navigator');
    } finally {
      poison.restore();
    }
  });
});

describe('§15 guard: importing core touches no platform global', () => {
  it('imports the public barrel cleanly — the SSR case, and the one consumers hit', async () => {
    expect(await importUnderPoison('../../src/index.ts')).toEqual({ touched: [], threw: null });
  });

  const sources = coreSourceFiles();

  it('sanity: there are modules to import', () => {
    expect(sources.length).toBeGreaterThan(40);
  });

  // Individually, not just through the barrel: a deep import
  // (`@dhaam-ccrm/core/dist/queue/...`), a bundler splitting a chunk, or a
  // future entry point can evaluate a module the barrel never reaches.
  it.each(sources.map((f) => f.path))('imports %s cleanly', async (path) => {
    const outcome = await importUnderPoison(`../../${path}`);
    expect(outcome).toEqual({ touched: [], threw: null });
  });
});

describe('§15 guard: BrowserStorageAdapter is the isolated exception, and only that', () => {
  it('is inert at import time like every other module', async () => {
    expect(await importUnderPoison('../../src/storage/browser.ts')).toEqual({
      touched: [],
      threw: null,
    });
  });

  it('reaches for localStorage only when a caller actually constructs it', async () => {
    // The other half of "isolated": the file is not DOM-free, it is
    // DOM-DEFERRED. Proving the deferral is what distinguishes this from a
    // file exemption — if the probe were hoisted to module scope, the test
    // above would fail and this one would still pass, so both are needed.
    vi.resetModules();
    const { BrowserStorageAdapter } = await import('../../src/storage/browser.js');
    const poison = poisonPlatformGlobals();

    try {
      expect(poison.touched).toEqual([]);
      expect(() => new BrowserStorageAdapter()).toThrow(/localStorage is not available/);
      expect(poison.touched).toContain('localStorage');
    } finally {
      poison.restore();
    }
  });

  it('never mentions window or document at all — React Native has neither', () => {
    // storage/browser.ts documents this promise about itself; the exemption
    // map in source-scan.ts allows it `localStorage` and nothing else, so this
    // assertion is what holds it to the claim.
    const browser = coreSourceFiles().filter((f) => f.path === 'src/storage/browser.ts');
    expect(browser).toHaveLength(1);
    expect(findNonPortableGlobals(browser)).toEqual([]);
  });
});

describe('§15 guard: no platform global is referenced anywhere in shipped source', () => {
  it('finds no window/document/localStorage reference outside the one adapter', () => {
    // The lazy-reference net. `window?.foo` inside a function survives the
    // import harness above but still has no meaning in a React Native engine,
    // so §15 rules it out too. Proved to trip in detectors.test.ts.
    const violations = findNonPortableGlobals(coreSourceFiles());
    expect(violations.map((v) => `${v.path}:${v.line} → ${v.detail}`)).toEqual([]);
  });
});
