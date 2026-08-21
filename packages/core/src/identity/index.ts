// Identity module barrel — internal to this package, the same role queue/'s
// and presence/'s barrels play. packages/core/src/index.ts decides which of
// these names leave @dhaam-ccrm/core; this file only gathers what identity/
// itself produced.
//
// ── What leaves the package, and what does not ───────────────────────────
//
// The two SEAM TYPES below are re-exported from packages/core/src/index.ts,
// type-only: a host has to be able to name `IdentityProfile` to build one and
// `IdentitySync` to implement one. Being type-only, they add nothing to the
// runtime allowlist in test/invariants/public-barrel-surface.test.ts.
//
// The DEDUP GATE below is NOT re-exported from packages/core/src/index.ts and
// must not be. It is reachable from here so the client wiring can call it, and
// no further. When core calls the injected `IdentitySync` is an implementation
// detail of core; a consumer able to reach in and record a false "already
// synced" could silently suppress a real identify. Exporting any of these four
// names from the top-level barrel would also trip that allowlist test, whose
// header is explicit that the fix is not to paste the new list in.

export type { IdentityProfile, IdentitySync } from './types.js';

export {
  IDENTITY_DEDUP_TTL_MS,
  profileFingerprint,
  recordIdentitySynced,
  shouldSyncIdentity,
  type IdentityDedupOptions,
} from './dedup.js';
