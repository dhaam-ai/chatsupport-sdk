# @dhaam-ccrm/js

## 0.1.0

### Minor Changes

- First published release of `@dhaam-ccrm/js` — a framework-free imperative store
  over one `ChatClient`: selector subscriptions with pluggable equality, event
  subscriptions, core-derived ticks, one-call disposal. Zero runtime dependencies,
  zero DOM. The substrate `@dhaam-ccrm/widget` is built on.

  `@dhaam-ccrm/core` is a **peer dependency**: this package re-exports
  `createChatClient` and core's error classes as runtime values, so a second copy
  of core in the tree would hand callers a different set of classes than the one
  core actually throws.
