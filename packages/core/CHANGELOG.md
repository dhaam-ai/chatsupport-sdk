# @dhaam-ccrm/core

## 0.1.0

### Minor Changes

- First published release of `@dhaam-ccrm/core`, the framework-agnostic heart of
  the SDK: transport, auth, connection state machine, message ordering and dedup,
  offline send queue, presence and unread watermarks — as plain TypeScript with
  zero framework, UI, DOM-document and runtime dependencies.

  `getState()` + `subscribe()` is a synchronous, reference-stable snapshot pair,
  which is `useSyncExternalStore`'s contract exactly. Every binding in this repo
  is a projection of that pair and nothing more.

  Core depends on **no other package in this monorepo**, and in particular has no
  edge to `@dhaam-ccrm/node` in either direction — that edge is how a secret key
  reaches a browser bundle.
