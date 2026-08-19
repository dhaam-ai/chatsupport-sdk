---
"@dhaam-ccrm/angular": minor
---

Add `@dhaam-ccrm/angular`, the Angular binding for `@dhaam-ccrm/core`.

One injectable store projects core's observable snapshot store onto Angular
**signals**, plus the §6.5 event catalog with `DestroyRef`-driven teardown.
No transport, reconnect, ordering, dedup, queueing, token-refresh or watermark
logic of its own — all of that is core's.

- **Signals, not Observables.** Core's store is a synchronous, reference-stable
  snapshot store, which is a signal's contract exactly; `computed(fn, { equal })`
  *is* the selector cache PRD §6.4 makes every binding write. An RxJS codebase
  bridges with `toObservable(store.messages)`, deriving from the same signal
  rather than opening a second subscription — so two consumers cannot disagree.
  This package has no `rxjs` peer dependency.
- **Zone-safe by construction.** Its only push into Angular is one
  `signal.set(...)`, which since Angular 18 schedules change detection
  regardless of which zone it happened in; an `NgZone` re-entry covers
  `ignoreChangesOutsideZone: true`. `provideZonelessChangeDetection()` works
  with no extra configuration.
- **No Angular decorators, so no ng-packagr.** `InjectionToken` + factories
  ship as plain ESM/CJS and are consumable from AOT builds unchanged.
- Passes the shared `@dhaam-ccrm/binding-conformance` suite (18/18, including
  the optional `computeTick` check), in vitest's `node` environment with no
  jsdom, zone.js, `TestBed`, or `@angular/compiler`.

Peer dependency: `@angular/core >= 18.0.0`.
