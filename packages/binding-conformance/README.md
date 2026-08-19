# `@dhaam-ccrm/binding-conformance`

**Internal. Not published to npm.**

The shared conformance suite every `@dhaam-ccrm` framework binding runs against
itself — the anti-divergence mechanism behind PRD §15's "reviewably thin,
behaves identically" requirement. It is framework-agnostic: each binding
implements a small `BindingAdapter`, and the same ~18 assertions run against
React, Vue, Angular and the vanilla-JS store.

## Why it is `private: true` for the 0.1.0 line

Publishing it would freeze `BindingAdapter`, `StateView`, `EventView` and
`ConformanceChatClient` as a **public API under semver** from day one, for zero
external consumers — every binding that uses it today (`js`, `vue`, `angular`)
does so as a `workspace:*` **devDependency**, so nothing published depends on
it. It also carries a `vitest` peer dependency, which would impose a test-runner
choice on anyone who installed it.

The argument for publishing is real but not yet due: a binding maintained
*outside* this repo could not prove conformance without it. When that binding
exists, publishing this package is a purely additive change. Un-publishing one
is not — which is why the reversible option is the right one first.

## Running it

```ts
import { runBindingConformance, createConformanceChatClient } from '@dhaam-ccrm/binding-conformance';

runBindingConformance(myAdapter);
```

See `packages/vue/test/vue-adapter.ts` for a worked adapter.
