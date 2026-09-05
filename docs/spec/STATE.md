# Project state — chat SDK v2

**Purpose:** everything needed to resume this work cold. Updated 2026-08-29.
Read this first; it is the index to the rest.

---

## Repos and branches

| | Path | Branch | Verified state |
|---|---|---|---|
| SDK | `chatsupport-sdk` | `feat/framework-agnostic-core` | typecheck + build clean, **pushed** |
| Backend | `../chat-service-node-integ` | `integ/backend-wave1` | build clean, **no upstream set on this branch** |

Both rows were wrong as written on 2026-08-19 and are corrected here. The
backend work is NOT on `sprint1-chat-service-node` in `../chat-service-node`;
it is on `integ/backend-wave1` in the `chat-service-node-integ` worktree.
Test counts are deliberately no longer quoted — every one previously written
down here had drifted, and a number that is only right on the day it is typed
is worse than no number. Run the suite.

The SDK is pushed. Secret scanning blocked it on two historical commits holding
synthetic `sk_live_…` fixtures; resolved by squashing 89 commits into one on top
of `a814e64`, so no reachable commit contains them. The granular history survives
locally on `backup-before-secret-rewrite` and its subjects in `COMMIT-LOG.md`.

**The backend branch has no upstream.** `origin` exists and is populated
(`git@github.com:dhaam-ai/chat-service-node`, with `main` and many feature
branches), but `integ/backend-wave1` has no tracking branch — `git rev-parse
--abbrev-ref @{u}` reports "no upstream configured". So the wave-1 work still
exists only on this machine even though the repo itself is not unpushed.
Push it: `git push -u origin integ/backend-wave1`.

## Packages

- `@dhaam-ccrm/core` — protocol, transport, connection state machine, offline
  queue, presence, messages, auth, storage, backoff. Zero runtime deps, no DOM.
- `@dhaam-ccrm/js` — framework-free binding. Selector subscriptions, event
  subscriptions, tick derivation. ~1.1 KB gzipped.
- `@dhaam-ccrm/browser` — voice recording (getUserMedia + MediaRecorder state
  machine with amplitude tracking), waveform decode (AudioBuffer with automatic
  AudioContext cleanup), read tracking (IntersectionObserver two-watermark).
  Zero dependencies, SSR-safe. Exists so React, Vue, Angular cannot drift on
  microphone teardown.
- `@dhaam-ccrm/react` — hooks over core. useMessages, useVoiceRecorder,
  useReadTracker, useAudioWaveform — delegates to @dhaam-ccrm/browser for DOM
  primitives. Ticks re-exported from core.
- `@dhaam-ccrm/vue` — Vue 3.3+ composables. useMessages, useVoiceRecorder,
  useReadTracker, useAudioWaveform — delegates to @dhaam-ccrm/browser.
- `@dhaam-ccrm/angular` — Angular 18+ signal stores. createVoiceRecorder,
  createReadTracker, createAudioWaveform — delegates to @dhaam-ccrm/browser.
- `@dhaam-ccrm/rest` — fetch adapters for the seams core deliberately does not
  implement (`MessageHistorySource`, `AttachmentUploader`, `SessionActions`).
- `@dhaam-ccrm/node` — backend SDK: token minting, webhook signature verification.
- `@dhaam-ccrm/widget` — embeddable HTML/CSS/JS widget, 32.6 KB gzipped. Owns
  trimmed voice implementation in src/ui/voice.ts for bundle size.
- `examples/demo` — runnable dogfooding app (token server + React page).

### Dart / Flutter (added 2026-09-05)

Three packages, deliberately split, mirroring the core/rest/UI shape above.

- `packages/dart` (`dhaam_chat`) — §7 frame protocol, §8 connection state
  machine, §10 auth, resume, outbox. **Pure Dart, one dependency**
  (`web_socket_channel`). No HTTP: that boundary is why `dart_rest` exists.
- `packages/dart_rest` (`dhaam_chat_rest`) — the REST surface `dhaam_chat` does
  not speak: history, `/upload`, session close/reopen/CSAT, `listSessions`,
  `/identify`, transcript email, report-issue, and the two unauthed bootstrap
  calls (`ip-watermark`, widget config). Pure Dart.
- `packages/flutter` (`dhaam_chat_flutter`) — the screens, `ChatWidgetCubit`,
  the typed `RemoteConfig` model.
- `packages/flutter/example` — **runnable** host app. This is the only way to
  exercise the port by hand; the packages are otherwise unit-tested only.

Unlike the TS split, **`dhaam_chat_rest` DOES depend on `dhaam_chat`** — see
ADR-0005 §1 for why the `no-core-import` invariant does not transfer. The
direction that does hold, and is asserted by a test: `dhaam_chat` imports
nothing from `dhaam_chat_rest`.

Scope, divergences and known gaps: **`docs/adr/0005-dart-flutter-parity-scope.md`**.

## Running locally

```bash
# backend — note DATABASE_URL must be explicit; the shell env overrides .env
cd ../chat-service-node
DATABASE_URL="postgresql://postgres@localhost:5432/chat_service?schema=public" \
  npm run dev                      # :3000, health at /chat-services/health

# demo
cd chatsupport-sdk && pnpm -r build
cd examples/demo && pnpm start     # :5173
```

Provisioned test key pair for tenant `12775` lives in `examples/demo/.env`.
`WS_V2_ENABLED=true` is required; the endpoint is opt-in and fails closed
without a provisioned publishable key.

### Flutter

Toolchain is pinned and several dependency pins exist only because of it:
**Flutter 3.24.4 / Dart 3.5.4**. `url_launcher` stays `^6.3.1` (6.3.2 needs
Dart ^3.6.0), `file_picker` `^11.0.3`, `shared_preferences` `^2.5.3`,
`record` `^6.2.1` — each verified by running `flutter pub get`, never assumed.

```bash
cd packages/flutter/example && flutter pub get
flutter run \
  --dart-define=DHAAM_WS_URL=wss://chat.your-host.example \
  --dart-define=DHAAM_API_URL=https://api.your-host.example \
  --dart-define=DHAAM_PUBLISHABLE_KEY=pk_test_... \
  --dart-define=DHAAM_ACCESS_TOKEN=...
```

No key has a default. An unset one renders a page naming every missing key
rather than crashing or hanging. The app also shows a **Seams panel** saying
which injectable seams are wired — read it before concluding a control is
missing.

Host platform entries the plugins oblige (the example carries exactly these
and no invented ones): macOS needs the *User Selected File Read* entitlement
plus `com.apple.security.network.client` (without the latter a sandboxed build
cannot open the socket at all), `NSMicrophoneUsageDescription` on iOS/macOS,
`RECORD_AUDIO` on Android, and `INTERNET` in Android's `src/main` — the
`flutter create` scaffold puts it only in `src/debug`, so a release build
debugs fine and then cannot connect.

**Suite is slow and contention-sensitive.** ~80s serial. Running other
`flutter` processes alongside it produces spurious widget-test failures whose
set differs run to run — measured at 12, 7, 2 and 0 failures for the same
commit under different load. Run it alone before believing a red result.

## Decisions that are binding (PRD §0.5)

- **D1** client ULID is the permanent message id; no id-swap path exists.
- **D2** monotonic per-session `seq`; `connection.ack` replays inline. `seq`
  orders, never `ts`.
- **D3** `connection.reauth` refreshes in place; reconnect is the fallback.
- **D4** one wire format — string enums, camelCase, ISO-8601, one canonical
  name per concept. Core ships zero coercion.

Amendments recorded in the PRD: `ChatState.presence` (T12), `ChatMessage.delivery`
+ `sendFailed` event (T10), attachment is **top-level** not under `metadata`.

Key prefixes are **`dhp_`/`dhk_`**. `pk_`/`sk_` is byte-identical to Stripe's; the
first attempt (`dhpk_`/`dhsk_`) still *contained* `sk_`, so 46.6% of generated keys
matched Stripe's detector — measured over 2000 samples, not assumed. The retired
`dhpk_`/`dhsk_` forms are still accepted so already-issued keys and shipped widget
bundles survive; only the new form is minted. Core rejects a foreign `sk_`
distinctly, so a pasted Stripe key gets a credential-incident error.

## Verified live (not just unit-tested)

- **End to end**: secret key → token mint → WS handshake → `connection.ack` →
  `message.send` → server `seq`, against real Postgres.
- **Cross-instance fan-out (B7)**: two instances on :3100/:3200 over one Redis; a
  message sent on A reached a client on B. This was the last unproven blocker.
- **Key backward compatibility**: retired `dhsk_` and new `dhk_` both mint (201).
- **CORS, rate limits, metrics access**: verified by the review agent on :3100 —
  allowlist admits the demo and denies unlisted origins, 120/min identity limit
  fires with correct `Retry-After`, 12 back-to-back reconnects never throttle,
  metrics 404 when disabled.

## Environment gotchas that cost real time

- **`DATABASE_URL` in the shell points at `dhaam` with no user** and overrides
  `.env` (dotenv does not overwrite existing vars). `dhaam` is the shared platform
  DB — OpenFGA, goose, PostGIS. Chat lives in **`chat_service`**. Pass it
  explicitly: `DATABASE_URL="postgresql://postgres@localhost:5432/chat_service?schema=public"`.
- **A `REDIS_HOST` of `localhost:6379` in YOUR SHELL** — host and port combined —
  makes ioredis try to resolve a hostname of that name and silently fall back to
  in-memory, disabling fan-out. This is an environment-value hazard, NOT a code
  defect: `src/config/index.ts:417-418` reads `REDIS_HOST` and `REDIS_PORT` as
  separate values and always did the moment it was fixed. An earlier revision of
  this document listed the concatenation as an outstanding bug further down,
  which contradicted this entry; that line is now marked fixed.
  Set `REDIS_HOST=localhost REDIS_PORT=6379`.
- **Rate limiting needs `trustProxy`**, now wired (`9add3c1`). Without it the
  address-keyed budgets are off by design — they collapse to one bucket per tenant
  behind a load balancer, which was a remote off-switch before it was caught.
- **`find -newermt` does not work here.** It returns nothing even for a
  just-touched file. Reading that as "no activity" caused a four-agent collision.
  Use `find … -exec stat -f '%m %N' {} + | sort -rn`.

## Remaining for production

**Scheduled but unbuilt**

Four entries that used to sit here have SHIPPED. Verified against
`chat-service-node-integ` @ `integ/backend-wave1` on 2026-08-29:

- ~~CORS is `origin: '*'`; `WIDGET_ALLOWED_ORIGINS` exists unused.~~ **Done.**
  The policy moved to `src/shared/utils/cors-policy.ts` (`src/api/rest/server.ts:123`
  records the change) and `WIDGET_ALLOWED_ORIGINS` is read at
  `src/config/index.ts:558`. `*` is still expressible but must now be written
  down explicitly, and production logs a warning when it is.
  **Still true and still a trap:** the allowlist is FLEET-WIDE, not per-tenant.
  Unset in production, a storefront browser silently drops the widget-config
  response — the widget degrades to local defaults and says so via `onError`.
- ~~No rate limiting outside `POST /tokens`.~~ **Done.** `src/api/websocket/v2/rate-limit.ts`
  plus `src/api/rest/routes/identify.routes.ts`; `trustProxy` is wired and has
  its own tests.
- ~~No observability on the v2 path.~~ **Done.** `src/shared/observability/metrics.ts`
  and `metrics-access.ts`, with fan-out instrumented in `src/api/websocket/v2/fanout.ts`.
- B7 fan-out is built and unit-tested but **never exercised against real Redis**.
- T17 conformance suite → T20/T21/T22 (Vue, Angular, vanilla).
- T19 generated Python/Go clients. T24 delete v1 `src/` and `dist/`.

**Known gaps, agreed but not started**
- ~~**v2 is customer-only.** `handlers.ts` hardcodes `senderType: CUSTOMER`.~~
  **Wrong on both halves.** `senderType` is DERIVED from the verified identity
  on the connection — `senderTypeFor(conn.user)` at
  `src/api/websocket/v2/handlers.ts:872`, applied at `:1956` — and has been for
  some time. A STAFF flow exists (`handshake-auth.ts`,
  `handlers-staff-hello-flag.test.ts`), selected by the ABSENCE of
  `connection.hello.publishableKey`. The SDK matches it as of
  `feat/widget-v2-upgrade`.
- **No local agent auth.** `authenticateAgent` requires a Cognito token; the
  documented dev path mints customer tokens only. *(Still true.)*
- ~~**WhatsApp-style features** not built: delivery ticks, voice recording,
  read tracking.~~ **All three are built.**
  - Delivery ticks are wired end to end: `message.markDelivered` /
    `message.delivered` exist in `protocol/frames.ts`, chat-service dispatches
    the former (`handlers.ts:2351`), and the widget renders all four tick
    states (`packages/widget/src/ui/message-list.ts`, `TICK_PRESENTATION`).
    `DeliveryStatus` is no longer "modelled but unused" — see the corrected
    comment in `protocol/enums.ts`.
  - Voice recording: `packages/widget/src/ui/voice.ts`.
  - Read tracking: `client.markRead()` plus the presence coordinator's
    watermarks in core.
- **Core and REST share no token seam** — every customer must write the
  `TokenStore` glue the demo invented. Highest-value ergonomics fix.
- Bindings re-export `createChatClient` only PARTLY: `@dhaam-ccrm/js` does
  (`packages/js/src/index.ts:84`); react/vue/angular still do not, and
  `createTokenProvider` is re-exported by no binding at all — it is reachable
  only from `@dhaam-ccrm/core`.
- `createHistorySource(rest)` infers `unknown`; needs an explicit type argument.
- `pnpm test` requires `pnpm -r build` first on a clean checkout.
- Backend `npm run lint` is broken repo-wide (ESLint 9 wants `eslint.config.js`).
- `npm audit`: 16 high, 4 moderate — all need framework major bumps.
- ~~Redis config concatenates host and port (`ENOTFOUND localhost:6379`).~~
  **Fixed.** `src/config/index.ts:417-418` reads `REDIS_HOST` (with a
  `REDIS_HOSTNAME` K8s alias) and `REDIS_PORT` as separate values.

## Hard-won knowledge — do not rediscover

- **`npm test` in the backend, never bare `npx jest`** — the script sets
  `NODE_OPTIONS=--experimental-vm-modules`; without it ESM tests fail to compile.
- **Envelope ids are ULID-validated.** A fixture containing I, L, O or U is not
  valid Crockford base32 and the frame is dropped silently before correlation.
- **`pnpm -r typecheck` is a separate gate.** `tsup` resolves from the entry and
  does not typecheck tests; untypechecked test files reached this branch twice.
- **Do not gate a shell `&&` chain on `grep`** — it succeeds when grep matches,
  so a failing test suite still lets the commit through. This happened twice.
- **Agents leave work uncommitted in worktrees.** Merging is often copy-then-verify,
  not `git merge`. Always re-run the suite in the main tree.
- **The seq-uniqueness drift test is flaky** under full-suite load; it passes alone.

### The dominant defect class in this project

**Seven tests have passed while asserting nothing** — twice with titles naming
the very invariant they failed to check, and once by comparing against the same
constant the code used. Every load-bearing assertion must be verified by breaking
the code and confirming failure. This has caught real bugs every single time.

## Database

`chat_service` on localhost:5432 (user `postgres`, no password) — 674 sessions,
3,727 messages, real data. A clone sits at `chat_service_backup`.
`dhaam` is the **shared platform DB** (OpenFGA, goose, PostGIS) — chat tables do
not belong there; the shell's `DATABASE_URL` wrongly points at it with no user.

The migration chain had **six defects** and could never run from scratch; all are
fixed and verified by deploying into a throwaway database. The worst: every enum
conversion ends in `ELSE 1`, so re-running on already-converted integer data
collapsed every AGENT and BOT to CUSTOMER. Conversions are now idempotent.
