// FIXTURE — the COMPLIANT counterpart to `eager-dom-read.ts`.
//
// It names the same global, but only inside a function body, so importing it
// touches nothing. This is the `storage/browser.ts` pattern that §15 permits.
//
// Its job is to prove the poisoned-global harness is not simply failing on
// everything: a harness that rejected this too would be indistinguishable from
// one that had banned the word `window` from the tree, and it would make the
// one legitimate platform-adapter file unwritable.
export function viewportWidth(): number {
  const w = (globalThis as { window?: { innerWidth?: number } }).window;
  return w?.innerWidth ?? 0;
}
