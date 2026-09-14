// The pairing between `exports` and `sideEffects` in this package's manifest.
//
// `sideEffects` is an ARRAY, which means it is a WHITELIST: every file not
// named in it is declared side-effect-free, and a bundler is then entitled to
// drop it if nothing appears to be imported from it. That is correct and
// wanted for the npm entry (`dist/index.js`), whose whole value is being
// tree-shakeable — and it is silently wrong for the script-tag bundles.
//
// `dist/widget.js` and `dist/form.js` export NOTHING. They exist to run:
// `installFormGlobal()` puts `window.DhaamForm` on the page and boots the
// forms the script tag points at. A bundler that reaches one of them through
// the subpath export and finds no used binding will remove the call, leaving
// a script that loads, does nothing, and reports no error at all.
//
// So the two halves of a script-bundle subpath export — the `exports` entry
// and the `sideEffects` entry — are one change, and this file is what makes
// adding half of it a failing test rather than a silent no-op in someone
// else's build. It reads the manifest as data, so it covers every such
// subpath added later without being edited.
//
// Two shapes defeated an earlier version of this file and are the reason it
// resolves targets rather than reading subpath names. A conditional export
// (`{ "default": "./dist/x.js" }`) is an OBJECT, not a string — and this very
// manifest already uses that shape for `"."` — so a name-based filter skipped
// it entirely and passed with the pairing half-applied. And a subpath spelled
// `./x.mjs` pointing at a `.js` bundle was skipped for the same reason from the
// other end. What decides is the TARGET a bundler actually resolves to, so that
// is what this reads.

import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, unknown>;
  sideEffects: string[];
  files: string[];
};

/**
 * Every file a subpath export can resolve to, flattened. A target is either a
 * string or a conditions object whose values are targets (possibly nested), so
 * this walks it rather than assuming the string form.
 */
function targetsOf(target: unknown): string[] {
  if (typeof target === 'string') return [target];
  if (target !== null && typeof target === 'object') {
    return Object.values(target as Record<string, unknown>).flatMap(targetsOf);
  }
  return [];
}

/**
 * Subpath exports resolving to a script bundle, keyed on the TARGET's
 * extension rather than the subpath's — see the header. `.` is excluded by
 * name: it is the npm entry, and its whole value is being shakeable.
 */
const scriptBundles = Object.entries(manifest.exports)
  .filter(([subpath]) => subpath !== '.' && subpath !== './package.json')
  .flatMap(([subpath, target]) =>
    targetsOf(target)
      .filter((file) => file.endsWith('.js') && !file.startsWith('./dist/index.'))
      .map((file) => [subpath, file] as const),
  );

describe('script-tag bundles and sideEffects', () => {
  it('declares every script-bundle subpath export as having side effects', () => {
    expect(scriptBundles.length).toBeGreaterThan(0);
    for (const [subpath, target] of scriptBundles) {
      expect(manifest.sideEffects, `${subpath} -> ${target} is missing from sideEffects`).toContain(target);
    }
  });

  it('exports ./form.js, and declares dist/form.js side-effectful with it', () => {
    // The standalone web form's script-tag artifact (BL-92). Also served from
    // the SDK CDN; the subpath export is the bundler-resolvable half.
    expect(manifest.exports['./form.js']).toBe('./dist/form.js');
    expect(manifest.sideEffects).toContain('./dist/form.js');
  });

  it('leaves the npm entry OUT of sideEffects, so a consumer can still shake it', () => {
    expect(manifest.sideEffects).not.toContain('./dist/index.js');
    expect(manifest.sideEffects).not.toContain('./dist/index.cjs');
  });

  it('ships the directory those bundles live in', () => {
    expect(manifest.files).toContain('dist');
  });

  it('points every script-bundle export at a file the build actually emits', () => {
    // Reading the manifest as data cannot see whether the target is THERE. If
    // `scripts/bundle.mjs` stops emitting `dist/form.js` — or a release runs
    // bare `tsup` instead of this package's `build` — the published `exports`
    // map names a file that is not in the tarball, and
    // `import '@dhaam-ccrm/widget/form.js'` throws ERR_MODULE_NOT_FOUND for
    // every bundler consumer while every other assertion here stays green.
    //
    // Skipped when NONE of them exist, because that is a build this checkout
    // has not run rather than a manifest that lies — `dist/` alone is not the
    // signal, since `tsup` populates it with the npm entry while the script
    // bundles come from `scripts/bundle.mjs` afterwards. It bites exactly
    // where it should: some bundles emitted, a declared one missing.
    const present = scriptBundles.filter(([, target]) =>
      existsSync(new URL(`../${target.replace(/^\.\//, '')}`, import.meta.url)),
    );
    if (present.length === 0) return;
    for (const [subpath, target] of scriptBundles) {
      expect(
        existsSync(new URL(`../${target.replace(/^\.\//, '')}`, import.meta.url)),
        `${subpath} -> ${target} is exported but was not emitted by the build`,
      ).toBe(true);
    }
  });
});
