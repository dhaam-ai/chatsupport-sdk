---
"@dhaam-ccrm/widget": minor
---

**`dist/form.js` is now reachable as the `./form.js` subpath export.**

The artifact is not new — `scripts/bundle.mjs` has been producing it — it
simply had no way in for a consumer using a bundler rather than a script
tag. `import '@dhaam-ccrm/widget/form.js'` now resolves.

It is declared side-effectful in the same change, and that half is not
optional. `sideEffects` here is an array, which makes it a whitelist: every
file not named in it is declared side-effect-free. `dist/form.js` exports
nothing and exists only to run — `installFormGlobal()` installs
`window.DhaamForm` and mounts the forms the script tag points at — so a
bundler that reaches it through the new export, finds no used binding and is
told the file is pure will drop that call. The script then loads, does
nothing, and reports no error at all. Adding the export without the
`sideEffects` entry is a silent break, not a missed optimisation, and
`test/package-side-effects.test.ts` now fails the build if the two halves are
ever separated — resolving conditional-object targets as well as plain
strings, and keying on the target's extension rather than the subpath's, so
neither shape can slip past it. It also fails if an exported bundle is
declared but never emitted.
