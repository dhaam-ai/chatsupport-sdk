# Chat SDK — reference integration

A small, deliberately plain app that consumes `@dhaam-ccrm/core`,
`@dhaam-ccrm/rest` and `@dhaam-ccrm/react` **exactly as a customer would** —
through each package's public entry point, never a deep import into
`packages/*/src/*`.

It exists to answer one question: can you actually run this SDK against a real
chat-service with one publishable + secret key pair?

```
browser                        this Node process              chat-service
───────                        ─────────────────              ────────────
ChatProvider                   POST /api/token  ──────────▶   POST /chat-services/api/v1/tokens
  ├ publishable key              (holds dhsk_…)                 Authorization: Bearer dhsk_…
  ├ access token   ◀────────────  { accessToken,                ▼
  └ WebSocket      ─────────────────────────────────────────▶  /chat-services/v2/ws
                                    expiresIn }
```

The secret key never reaches the browser. That split is the entire point of
the two-key model, and it is why this demo has a server process at all — a
browser-only integration is impossible by design.

---

## 1. Prerequisites

- Node 20.6+ (22.x recommended — `pnpm start` uses `--env-file-if-exists`)
- pnpm 10+
- **Postgres running.** Redis is optional: chat-service falls back to an
  in-memory cache and logs warnings.
- A local checkout of `chat-service-node`.

---

## 2. Start the backend

From your `chat-service-node` checkout:

```bash
npm install
```

Create `.env`:

```bash
NODE_ENV=development
APP_PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chat_service?schema=public

# Default is ON and points at a cluster broker. Non-fatal, but noisy.
KAFKA_ENABLED=false

# Strict opt-in — the v2 WebSocket route is not registered without this,
# and it is NOT in .env.example.
WS_V2_ENABLED=true

# Must be >= 32 characters or token minting refuses.
CHAT_ACCESS_TOKEN_SECRET=change-me-to-at-least-32-characters-long
```

Three things bite people here:

| Trap | Detail |
|---|---|
| `APP_PORT`, not `PORT` | `PORT` is not read anywhere. |
| `WS_V2_ENABLED` is exact | Only the literal string `true` enables `/chat-services/v2/ws`. |
| `KAFKA_ENABLED` defaults ON | Only the literal string `false` disables it. |

Apply migrations and generate the client:

```bash
npm run prisma:generate
npx prisma migrate deploy
```

> Use `migrate deploy`, not `npm run prisma:migrate` (`prisma migrate dev`), on
> a database you care about: `migrate dev` may offer to **reset** the database
> when it detects drift. See [Troubleshooting](#5-troubleshooting) if this step
> fails — on a database with existing chat-service tables it currently does.

Provision one key pair. `--tenant` is any string you choose; no tenant row has
to exist first:

```bash
npm run keys:create -- --tenant demo-tenant --env test
```

Note `--tenant demo-tenant`, **not** `--tenant=demo-tenant` — the script reads
the following argv entry, so the `=` form silently yields `undefined`. Also
note `--env` accepts only the exact string `test`; anything else, including a
typo, produces a **live** key pair.

It prints both halves once:

```
  Publishable key (safe to ship in a browser bundle):
    dhpk_test_…
  Secret key (server-side only — shown ONCE, never recoverable):
    dhsk_test_…
```

Start it:

```bash
npm run dev
```

Sanity check: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/chat-services/health` → `200`.

---

## 3. Start the demo

From the SDK repo root:

```bash
pnpm install
pnpm -r build     # REQUIRED — see note below
```

`pnpm -r build` is not optional. The demo resolves the SDK through each
package's `exports` field, which points at `dist/`. That is the same path a
customer's bundler takes from npm, which is the point — but it means an
unbuilt workspace fails to resolve. (The same is true of `pnpm test`: the
React package's tests import `@dhaam-ccrm/core` by name, so a clean checkout
must build before it can test.)

Then:

```bash
cd examples/demo
cp .env.example .env
# paste the dhpk_ and dhsk_ values from keys:create into .env
pnpm start
```

One command, one process: it bundles the browser app with esbuild, serves it,
and exposes `POST /api/token`.

Open **http://localhost:5173** and press **Connect**.

---

## 4. What "working" looks like

1. The connection panel moves `Not connected → Connecting… → Authenticating… → Connected`.
2. **Session** fills in with an id, **Status** shows the session status.
3. Typing in the message field sends typing notifications; the agent side sees them.
4. Pressing **Send** appends your message immediately with `Sending…`, which
   disappears once the server acknowledges it.
5. Messages from the other side appear live, and **Unread** increases until you
   press **Mark read**.

The boot banner confirms what the server loaded, and deliberately prints only
the secret key's prefix:

```
  API      http://localhost:3000
  WS       ws://localhost:3000/chat-services/v2/ws
  Key env  test
  Pub key  dhpk_test_…
  Secret   dhsk_test_… (loaded, never sent to the browser)
  User     demo-user-1 (Demo User)
```

To confirm the key split yourself, grep the served assets for your actual
secret — both must report `0`:

```bash
set -a; . ./.env; set +a
curl -s http://localhost:5173/       | grep -c "$CHAT_SECRET_KEY"
curl -s http://localhost:5173/app.js | grep -c "$CHAT_SECRET_KEY"
```

Do **not** grep for the bare string `dhsk_`: the bundle legitimately contains
it. `@dhaam-ccrm/core`'s publishable-key validator carries the `dhsk_` prefix
as a constant so it can reject a secret key supplied where a publishable one
belongs, and that constant is bundled along with the validator. Matching the
prefix finds that constant, not a leak — match the key itself.

---

## 5. Troubleshooting

**`prisma migrate deploy` fails: `relation "widget_apps" does not exist`**

This is a chat-service-node migration-ordering problem, not an SDK one.
`prisma/migrations/20250625_merge_widget_into_tenant` does an unguarded
`UPDATE … FROM "widget_apps"`, but the migration that *creates* `widget_apps`
is `20260303065718_baseline` — and Prisma applies migrations in lexicographic
name order, so `2025-06-25` runs **before** the `2026-03-03` baseline. Its
sibling statements use `IF NOT EXISTS` / `IF EXISTS`; the `UPDATE` does not.

A failed migration also blocks every later one until it is resolved:

```bash
npx prisma migrate resolve --rolled-back 20250625_merge_widget_into_tenant
```

Fixing it properly belongs in chat-service-node — either guard the `UPDATE`
with a `to_regclass('public.widget_apps') IS NOT NULL` check, or renumber the
migration to sort after the baseline.

**`POST /api/token` returns 502 `cannot reach chat-service`**
chat-service is not running, or `CHAT_API_URL` is wrong. It must be an
**origin** — `http://localhost:3000`, no path.

**502 with `chat-service rejected the secret key (401)`**
`CHAT_SECRET_KEY` is not a valid `dhsk_…`, has been revoked, or belongs to a
different tenant than `CHAT_API_URL` serves. chat-service returns an identical
generic 401 for all of these on purpose, so there is no way to tell them apart
from the response — re-run `keys:create`.

**502 with `chat-service failed to mint a token (500)`**
Most often the `api_keys` table does not exist because
`20260818120000_add_api_keys` has not been applied — see the migration problem
above. Also check `CHAT_ACCESS_TOKEN_SECRET` is at least 32 characters.

**The demo exits at boot with a configuration problem**
Both key shapes are validated before the server listens, so a swapped pair
fails immediately rather than shipping a `dhsk_` to a browser. The message
names the offending variable.

**Connection reaches `authenticating` then drops with `Credential tenant mismatch`**
The token's environment does not match the publishable key's. Both halves must
come from the *same* `keys:create` run — the demo checks this at boot too.

**Connection never leaves `connecting`**
`WS_V2_ENABLED=true` is missing, so `/chat-services/v2/ws` was never
registered. Note the WebSocket is on `APP_PORT` (3000), **not** `WS_PORT`
(3001) — 3001 is the legacy v1 socket.io server.

**`Failed to resolve entry for package "@dhaam-ccrm/core"`**
Run `pnpm -r build` from the repo root.

---

## 6. Pointing at production

Nothing in the code changes — only `.env`:

```bash
CHAT_PUBLISHABLE_KEY=dhpk_live_…
CHAT_SECRET_KEY=dhsk_live_…
CHAT_API_URL=https://chat.example.com
CHAT_WS_URL=wss://chat.example.com/chat-services/v2/ws
```

- Use a **`live`** pair from `npm run keys:create -- --tenant <id> --env live`.
  Both halves must come from the same run; mixing `live` and `test` is rejected
  at boot here, and by the server as `Credential tenant mismatch`.
- `wss://`, not `ws://`. `CHAT_WS_URL` is always given explicitly and never
  derived from `CHAT_API_URL` — the SDK refuses to guess a WebSocket host from
  an HTTP one, and neither does this demo.
- `CHAT_API_URL` stays an origin. `@dhaam-ccrm/rest` appends
  `/chat-services/api/v1`; adding it yourself produces a doubled path.

**This demo is not a production integration.** Before shipping anything
resembling it:

- `POST /api/token` here mints for a single user fixed in config, and reads
  nothing from the request. That is what stops it being an impersonation
  endpoint. Your real endpoint must mint for **the user your app has already
  authenticated**, derived from their session — never from a request field.
- Add CSRF protection, rate limiting and your own auth to that route.
- Serve over HTTPS so the token is not readable in transit.

---

## 7. What integrating actually felt like

Notes from building this against the published surfaces. These are SDK
findings, recorded here because the demo is where they surfaced.

**Required `history`, `localSender` and `wsUrl` are the right call.** All three
are genuinely unguessable, and each is one line at the call site.
`localSender` in particular prevents a real bug: a session carries both a
customer and an agent, so a defaulted `CUSTOMER` would silently mislabel every
message an agent-side embed sends.

**Keeping your own copy of the access token is the one real friction point.**
Core calls `getToken` and owns refresh, but never exposes the token it is
currently using — while `RestClient` needs that same token for every HTTP
request. There is no seam connecting them, so the integrator has to maintain a
`TokenStore` that both read (see `src/chat-client.ts`). It works, but the REST
side can drift behind a token core has already refreshed. Exposing the current
token, or letting core own the REST client's credential, would remove the only
piece of state this demo was forced to invent.

**The REST adapter factories need explicit type arguments.**
`createHistorySource(rest)` infers `unknown` and then fails to satisfy
`MessageHistorySource`; you must write `createHistorySource<ChatMessage>(rest)`.
The error points at the config object, not at the missing type argument, which
is a confusing first experience.

**`@dhaam-ccrm/react` re-exports core's types but not its runtime helpers.**
`ChatState`, `ChatMessage` and friends come from the React package, but
`createTokenProvider` does not, so a React-only consumer still needs a direct
`@dhaam-ccrm/core` dependency. Re-exporting `createTokenProvider` and
`createChatClient` would make `@dhaam-ccrm/react` genuinely self-sufficient.

**`createTokenProvider` earns its place.** chat-service returns
`expiresIn` in **seconds**; core's native field is `expiresInMs`. The obvious
hand-written adapter typechecks and turns a 3600-second token into a 3600ms
one, refreshing every ~2.9 seconds forever. Using the helper makes that
unwritable — but nothing forces you to, so it deserves to be the first thing
the integration guide shows.
