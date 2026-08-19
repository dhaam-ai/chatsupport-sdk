# Project state — chat SDK v2

**Purpose:** everything needed to resume this work cold. Updated 2026-08-19 (late).
Read this first; it is the index to the rest.

---

## Repos and branches

| | Path | Branch | Verified state |
|---|---|---|---|
| SDK | `chatsupport-sdk` | `feat/framework-agnostic-core` | **1434 tests**, typecheck + build clean, **pushed** |
| Backend | `../chat-service-node` | `sprint1-chat-service-node` | **698 tests**, build clean, **NOT pushed** |

The SDK is pushed. Secret scanning blocked it on two historical commits holding
synthetic `sk_live_…` fixtures; resolved by squashing 89 commits into one on top
of `a814e64`, so no reachable commit contains them. The granular history survives
locally on `backup-before-secret-rewrite` and its subjects in `COMMIT-LOG.md`.

**The backend has never been pushed.** Everything below — six migration defects,
five auth holes, a self-inflicted per-tenant DoS, D2 replay, cross-instance
fan-out, all hardening — exists only on this machine. Push it first:
`git push -u origin sprint1-chat-service-node`.

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
- **`REDIS_HOST` is `localhost:6379`** — host and port combined, so ioredis tries to
  resolve a hostname of that name and silently falls back to in-memory, disabling
  fan-out. Use `REDIS_HOST=localhost REDIS_PORT=6379`.
- **Rate limiting needs `trustProxy`**, now wired (`9add3c1`). Without it the
  address-keyed budgets are off by design — they collapse to one bucket per tenant
  behind a load balancer, which was a remote off-switch before it was caught.
- **`find -newermt` does not work here.** It returns nothing even for a
  just-touched file. Reading that as "no activity" caused a four-agent collision.
  Use `find … -exec stat -f '%m %N' {} + | sort -rn`.

## Remaining for production

**Scheduled but unbuilt**
- CORS is `origin: '*'` on the REST surface; `WIDGET_ALLOWED_ORIGINS` exists unused.
- No rate limiting outside `POST /tokens`.
- No observability on the v2 path — no metrics, no lifecycle logs, no alerts.
- B7 fan-out is built and unit-tested but **never exercised against real Redis**.
- T17 conformance suite → T20/T21/T22 (Vue, Angular, vanilla).
- T19 generated Python/Go clients. T24 delete v1 `src/` and `dist/`.

**Known gaps, agreed but not started**
- **v2 is customer-only.** `handlers.ts` hardcodes `senderType: CUSTOMER` on
  `message.send`. No agent/staff role exists, so the SDK cannot build an agent app.
- **No local agent auth.** `authenticateAgent` requires a Cognito token; the
  documented dev path mints customer tokens only.
- **WhatsApp-style features** requested and scoped, not built: delivery ticks
  (the `message_receipts` table exists and is wired to nothing; `DeliveryStatus`
  is modelled but unused — Open Question 8), voice recording, read tracking.
- **Core and REST share no token seam** — every customer must write the
  `TokenStore` glue the demo invented. Highest-value ergonomics fix.
- Bindings do not re-export `createChatClient`/`createTokenProvider`.
- `createHistorySource(rest)` infers `unknown`; needs an explicit type argument.
- `pnpm test` requires `pnpm -r build` first on a clean checkout.
- Backend `npm run lint` is broken repo-wide (ESLint 9 wants `eslint.config.js`).
- `npm audit`: 16 high, 4 moderate — all need framework major bumps.
- Redis config concatenates host and port (`ENOTFOUND localhost:6379`).

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
