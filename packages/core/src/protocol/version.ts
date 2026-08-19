// The protocol version this build of core speaks — PRD §7.5.
//
// Lives in `protocol/`, not in the top-level package barrel, so that
// `transport/` (task T7) can depend on it without importing the package's
// own public entry point (`src/index.ts`) — that entry point is assembled
// by task T13 and will itself import from `transport/`, so a dependency the
// other way would be circular. `src/index.ts` re-exports this constant
// rather than declaring its own copy.

/** Bumped on any breaking change to frame shapes or semantics (§7.5). */
export const CORE_PROTOCOL_VERSION = 1;
