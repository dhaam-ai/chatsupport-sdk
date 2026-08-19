# @dhaam-ccrm/react

## 0.1.0

### Minor Changes

- First published release of `@dhaam-ccrm/react` — `useSyncExternalStore` hooks
  over one `ChatClient`, plus the SSR-safe DOM-side hooks (`useReadTracker`,
  `useVoiceRecorder`) that core deliberately does not own.

  `@dhaam-ccrm/core` is a **peer dependency**, not a bundled one. This package
  re-exports core's error classes as runtime values, so two copies of core in one
  tree would make `err instanceof ChatClientConfigError` silently false — a peer
  range guarantees exactly one copy.
