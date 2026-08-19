# @dhaam-ccrm/vue

## 0.1.0

### Minor Changes

- First published release of `@dhaam-ccrm/vue` — `shallowRef`-backed composables
  over one `ChatClient`. Passes the shared binding-conformance suite.

  `@dhaam-ccrm/core` is a **peer dependency**: `context.ts` calls core's
  `createChatClient` and `use-message-ticks.ts` calls `deriveTickStateFromState`
  as runtime values, so exactly one copy of core must exist in the tree.
