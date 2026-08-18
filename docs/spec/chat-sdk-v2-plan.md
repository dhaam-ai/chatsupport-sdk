# Implementation Plan — Chat SDK v2

**Source spec:** `docs/spec/chat-sdk-v2-prd.md` (approved; decisions D1–D4 locked in §0.5)
**Branch:** `feat/framework-agnostic-core`
**Date:** 2026-08-18

---

## 0. Tooling (fixed — already scaffolded)

| Concern | Choice | Rationale |
|---|---|---|
| Workspaces | pnpm | Strict node_modules prevents a binding from accidentally importing a dep it never declared — the exact failure that lets `core` grow a hidden framework dependency. |
| Build | tsup | Already proven in this repo; dual ESM/CJS + `.d.ts` in one config. |
| Test | vitest | Native ESM/TS, fast watch, works for pure-logic and fake-server suites alike. |
| Versioning | changesets | Multi-package repo needs per-package semver and a generated changelog; `fixed` group keeps `@dhaam-ccrm/*` versions in lockstep so binding/core mismatches are impossible. |
| Language | TypeScript 5.x → ES2020 | Matches PRD §14 compatibility target. |

Scaffolded: `pnpm-workspace.yaml`, `tsconfig.base.json`, root workspace `package.json`, `vitest.config.ts`, `.changeset/config.json`, `packages/core/` skeleton.

---

## 1. Repository decisions

**`dist/` stops being committed.** v1 committed its build output (see git history: "commit pre-built dist and remove prepare script"). v2 publishes from CI via changesets, so build artifacts leave the tree. The existing root `dist/` stays only until `src/` is deleted (T24), because it is the currently-published v1 artifact.

**v1 (`@chat-service/sdk`) is frozen, not migrated.** v2 ships under a new scope (`@dhaam-ccrm/*`), so there is no accidental semver upgrade path from v1 — an existing consumer cannot be broken by a `^1.0.0` range resolving into a rewrite. Deprecate `@chat-service/sdk` on npm (`npm deprecate` pointing at the new scope) once `core` + `react` are published, not before.

**`src/` is reference-only** per PRD §15, and is deleted in T24 once every behavior it documents is either implemented in `core` or explicitly recorded as dropped. Its dead `*.clean.*` duplicate tree is already removed.

---

## 2. Backend work — external dependency, different repo

D1–D4 and the key model are all net-new server work. None of it lives in this repo, and none of it blocks client work starting (see §3).

| # | Backend task | Blocks (client-side) |
|---|---|---|
| **B1** | Accept client ULID as the permanent message id; validate format; enforce per-session uniqueness | End-to-end send/dedup verification (T11) |
| **B2** | Monotonic per-session `seq`; `connection.ack` replays frames after `resumeFrom` inline | End-to-end resume verification (T8, T10) |
| **B3** | `connection.reauth` on an open socket | End-to-end refresh verification (T9) |
| **B4** | One wire format: string-name enums, camelCase keys, ISO-8601 timestamps | Nothing — core is written assuming this and simply fails loudly otherwise |
| **B5** | `POST /v1/tokens` — secret-key JWT minting | `@dhaam-ccrm/node` integration test (T16) |
| **B6** | Publishable-key tenant resolution in the WS handshake; reject wrong-tenant tokens with `AUTH_INVALID` | Auth integration test (T9) |
| **B7** | Structured error frames with the §7.4 code enum | Error-branching integration test (T7) |

**Full six-value `ChatStatus`** (`OPEN`/`WAITING_FOR_AGENT`/`ASSIGNED`/`CLOSED`/`RESOLVED`/`ON_HOLD`) must be emitted — v1's type system only modelled four, so `RESOLVED` and `ON_HOLD` have been silently collapsing to `OPEN`. Folded into B4.

---

## 3. What core builds and fully tests *without* the backend

This is the point that keeps client work off the critical path. A **fake in-process WS server** (T6) is a first-class deliverable, not test scaffolding — it is the conformance target for the frame protocol and the only way binding parity gets verified before a real server exists.

Fully testable against pure logic or the fake server:

- Connection state machine — all 7 states and every transition (T8)
- Full-jitter exponential backoff — bounded-delay sequence assertions (T5)
- Offline queue — durability across a simulated reload, FIFO-per-session ordering, retention limits (T10)
- ULID dedup — replay of an already-persisted frame produces exactly one message (T10/T11)
- Token refresh *timing* — proactive fire at 80% of `expiresIn`, reactive on `AUTH_EXPIRED`, `suspended` after 3 consecutive failures (T9)
- Observable store — full-snapshot delivery, microtask batching (T3)
- Frame codec — round-trip encode/decode, malformed-frame rejection (T1/T7)

Only the seven B-tasks above need a real server, and each maps to one integration test rather than to a feature.

---

## 4. Tasks

| ID | Title | Scope | Needs | Size |
|---|---|---|---|---|
| T1 | Frame protocol contracts: envelope, frame-type catalog, enums, error codes | `packages/core/src/protocol` | — | M |
| T2 | OpenAPI spec for the REST surface (tokens, sessions, messages, upload) | `openapi/` | — | M |
| T3 | Observable store: `getState`/`subscribe`/`on`, microtask batching | `packages/core/src/state` | T1 | M |
| T4 | `StorageAdapter` interface + in-memory and browser implementations | `packages/core/src/storage` | — | S |
| T5 | Full-jitter exponential backoff policy | `packages/core/src/backoff` | — | S |
| T6 | Fake in-process WS server harness (protocol conformance target) | `packages/core/test/fake-server` | T1 | M |
| T7 | Transport: WebSocket lifecycle, frame codec, validation, heartbeat/pong | `packages/core/src/transport` | T1, T6 | L |
| T8 | Connection state machine + resume-on-reconnect via `seq` | `packages/core/src/connection` | T5, T7 | L |
| T9 | Auth: `getToken` contract, proactive + reactive refresh, `connection.reauth` | `packages/core/src/auth` | T8 | M |
| T10 | Offline send queue: durability, FIFO-per-session, ULID dedup, retention | `packages/core/src/queue` | T4, T8 | L |
| T11 | Message ops: optimistic send, attachments, cursor pagination | `packages/core/src/messages` | T3, T10 | M |
| T12 | Presence, typing (single canonical pair), read watermarks | `packages/core/src/presence` | T3 | M |
| T13 | Assemble `createChatClient`; public barrel; API surface matches PRD §6 | `packages/core/src/index.ts` | T9, T11, T12 | M |
| T14 | Guard tests for the core invariants (no framework deps, no `sk_` reachable, no secrets logged) | `packages/core/test/invariants` | T13 | S |
| T15 | `@dhaam-ccrm/react` — `useChannel`, `useMessages`, `useTypingIndicator` via `useSyncExternalStore` | `packages/react` | T13 | M |
| T16 | `@dhaam-ccrm/node` — token minting, webhook signature verification, pagination iterators | `packages/node` | T2 | M |
| T17 | Binding conformance suite — one shared spec every binding must pass | `packages/binding-conformance` | T15 | M |
| T18 | Demo app dogfooding the published packages | `examples/demo` | T15 | M |
| T19 | Generated Python + Go backend clients from the OpenAPI spec | `clients/` | T2, T16 | M |
| T20 | `@dhaam-ccrm/vue` — composables over the same store | `packages/vue` | T17 | M |
| T21 | `@dhaam-ccrm/angular` — signals/observables binding | `packages/angular` | T17 | M |
| T22 | `@dhaam-ccrm/js` — vanilla binding | `packages/js` | T17 | S |
| T23 | CI: build, typecheck, test matrix, changesets release automation | `.github/workflows` | T13 | M |
| T24 | Delete `src/` and root `dist/`; ADRs for D1–D4; migration guide off v1 | `docs/`, repo root | T15, T23 | S |

**Acceptance criteria** for every task are the matching items in PRD §15 plus, at minimum: the task's own unit tests pass, `pnpm typecheck` is clean, and no task outside `packages/node`/`clients` may reference a secret key.

---

## 5. Waves and critical path

```
Wave  1  (x4)  T1  T2  T4  T5      contracts + leaf utilities, no interdependencies
Wave  2  (x3)  T3  T6  T16
Wave  3  (x3)  T7  T12 T19
Wave  4  (x1)  T8                  <- critical path narrows here
Wave  5  (x2)  T9  T10
Wave  6  (x1)  T11
Wave  7  (x1)  T13                 <- core public surface complete
Wave  8  (x3)  T14 T15 T23
Wave  9  (x3)  T17 T18 T24
Wave 10  (x3)  T20 T21 T22         all three remaining bindings in parallel
```

Computed from `chat-sdk-v2-dag.json` by topological ready-set, not hand-assigned. Waves 4, 6, and 7 are single-node — that is the real serial spine of this project, and no amount of parallelism removes it.

**Critical path:** T1 → T6 → T7 → T8 → T10 → T11 → T13 → T15 → T17 → T20/T21/T22. Everything expensive routes through the transport and state machine, which is correct — that is where the hard logic lives.

Note T17 (binding conformance suite) sits deliberately between React and the other three bindings. React is the first binding, so it is the one that discovers what the conformance contract actually needs to say; Vue/Angular/vanilla then have a real target to pass rather than a prose description to interpret.

---

## 6. Test strategy by layer

| Layer | Method | Needs a server? |
|---|---|---|
| Backoff, queue ordering, dedup, store, codec | Pure unit (vitest) | No |
| State machine, transport, auth timing | Fake in-process WS server (T6) | No |
| Binding parity | Shared conformance suite (T17) run against every binding | No |
| Wire conformance, token minting, resume | Integration against the real backend | Yes — B1–B7 |
| Demo app behavior | Browser checks (`/browser-test`) | Yes |

---

## 7. Risks

1. **Binding divergence — the risk this architecture exists to prevent.** Four bindings mapping the same store into four reactivity systems will drift unless parity is mechanically enforced. Mitigation: T17 is a shared executable suite, and PRD §15 requires each binding's `ChatState` to be a shared *type import*, never a hand-copied shape. Prose contracts do not survive four implementations.
2. **Backend is the true end-to-end critical path.** Client work proceeds fully against the fake server, but nothing ships to a customer until B1–B7 land. The fake server is also a divergence risk in its own right — if it is more permissive than the real server, core passes its tests and fails in production. Mitigation: the fake server validates frames strictly against the T1 schema, rejecting anything the spec does not permit.
3. **`connection.reauth` has zero precedent (D3).** v1 never refreshed a token at all. If in-place reauth proves infeasible server-side, core falls back to transparent reconnect — the public API is identical either way (PRD §10.5), so this is contained, but the fallback path must be tested from day one rather than treated as dead code.
4. **`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`** are enabled in `tsconfig.base.json`. They catch real bugs in exactly this kind of message/state code, and they will also make some idiomatic patterns noisier. Keep them; do not relax them per-package to unblock a task.
5. **Scope name `@dhaam-ccrm` is unverified on npm.** Confirm the org exists and is controlled before T15 publishes anything, and before the OpenAPI `info` block bakes it in.
