// Public surface of the storage module (PRD §9.1).
//
// Adapters live in separate modules and never import one another, so a
// consumer who uses only MemoryStorageAdapter does not pull the browser
// adapter into their bundle. This barrel is re-export only and every module
// behind it is free of module-scope side effects, which — together with
// "sideEffects": false in package.json — is what lets a bundler drop the
// unused adapter rather than merely hoping to.
//
// Deep imports (./storage/memory.js) remain available for consumers whose
// bundler does not tree-shake.

export type { StorageAdapter } from './types.js';

export {
  StorageError,
  isStorageError,
  type StorageErrorCode,
} from './errors.js';

export { MemoryStorageAdapter } from './memory.js';

export {
  BrowserStorageAdapter,
  createBrowserStorageAdapter,
  type WebStorageLike,
} from './browser.js';

export { namespaced } from './namespace.js';
