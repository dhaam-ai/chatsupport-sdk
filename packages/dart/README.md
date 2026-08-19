# `dhaam_chat` — Dart client for the chat v2 wire protocol

Pure Dart. No Flutter import anywhere, so the whole client runs under
`dart test` with no device and no network. One runtime dependency,
`web_socket_channel`, because `dart:io`'s WebSocket does not exist on Flutter
Web and `dart:html`'s does not exist off it.

This package exists because Flutter cannot consume `@dhaam-ccrm/core` — a
different runtime, and no JS interop worth having. The state machine is
implemented a second time, from the spec. That was the cost the PRD
anticipated, and it is why §7 was meant to be implementable from spec alone.

```dart
final client = ChatClient(
  wsUrl: Uri.parse('wss://chat.example.com/v2'),
  publishableKey: PublishableKey.parse(const String.fromEnvironment('DH_KEY')),
  getToken: () => myBackend.mintChatToken(),
);

client.messages.listen((m) => setState(() => _byId[m.id] = m));
client.gaps.listen((gap) => refetchOverRest(gap.fromSeq, gap.toSeq));

await client.connect();
client.sendMessage('Hello');   // returns the optimistic echo synchronously
```

## What is here

| Area | Status |
|---|---|
| §7.2 envelope codec + §7.3 catalog, with validation | Done |
| §8 lifecycle: connect, hello→ack, heartbeat, close | Done |
| §8.2 full-jitter backoff, saturating | Done |
| D2 resume: `resumeFrom`, inline replay, gap detection | Done |
| D1 optimistic send, client ULID as permanent id | Done |
| §10 publishable key + `getToken` callback | Done |
| §9.1 durable offline queue | **Out of scope** |
| Delivery ticks (`message.markDelivered`/`.delivered`) | **Out of scope** — frames decode, nothing acts |
| Attachments upload | **Out of scope** — inbound metadata decodes |
| Voice | **Out of scope** |
| REST (pagination, history, `pastSessions`) | **Out of scope** — `gaps` names the span to refetch |

### Seams left for the out-of-scope work

- **Offline queue.** `ConnectionController.send` returns `bool`. `ChatClient`
  turns `false` into `MessageDelivery.failed`; a queue slots in exactly there,
  turning it into `queued` instead. No other code has to change.
- **Delivery ticks.** `message.delivered` already decodes. It needs a
  watermark field and a `markDelivered` call on the same shape as `markRead`.
- **REST.** Nothing in this package does HTTP. `ResumeGap` is the trigger.
- **Storage.** No `StorageAdapter` yet, because nothing here persists. The
  queue is what will need one.

## Auth: how the secret key is made impossible

Every string compiled into a Flutter app is extractable from the IPA or APK
with `strings`. A secret key here is a secret key on every user's device, and
this one mints user tokens.

1. `PublishableKey` has **only a private constructor**. Dart privacy is
   library-scoped, so it is unreachable from the rest of this package.
   `PublishableKey.parse` is the sole way to obtain one, and it rejects secret
   keys before anything else.
2. Every API takes a `PublishableKey`, never a `String` — so a secret key
   cannot be supplied even deliberately. This is stronger than the TypeScript
   core's branded string, which `as` defeats; `String` is not a subtype of
   `PublishableKey` and no cast produces one.
3. **There is no secret-key code path to reach.** No token minting, no
   `POST /tokens` client, no `Authorization: Bearer dhk_…`. Tokens arrive from
   the host through `TokenProvider` and are minted on the customer's backend.

Nothing logs a token, key, prefix, or length. Errors name the *category* of
failure only — a length fingerprints a credential and a prefix correlates one,
and Flutter hands uncaught errors to whatever crash reporter the host
installed.

---

## Spec gaps found

The PRD's success criterion #1 is that "a Swift/Kotlin/Flutter engineer with no
access to the TypeScript source could implement a conformant client purely from
§7 and the OpenAPI spec." **It does not hold today.** This is the list, ordered
by how hard each one bites.

### 1. §7.3 has no payload schemas at all — blocking

§7.3 is a table of frame *names* with a prose "Purpose" column. It defines no
field of any payload for any of the twenty-five frame types it lists. §7.2
specifies the envelope precisely and then says only that `d` is "the payload".
The OpenAPI document models REST and no WebSocket frames.

Roughly forty payload fields were recovered by reading the server. The four the
PRD names anywhere — `resumeFrom` (D2), `publishableKey` (§10.2),
`protocolVersion` (§7.5), `replay` (D2) — have no stated types.

### 2. `resumeFrom` is documented as two different types — blocking

§8.3: "`connection.hello.d` includes `resumeFrom`: the id/seq of the last frame
the client fully applied." An id is a ULID string; a seq is an integer.

D2 closes it — "carries the last applied `seq`" — and the server validates
`isInteger`. But §8.3 was never updated, so the one section that *describes
resume* is the section that gets it wrong. Following §8.3 means sending a ULID
and getting `VALIDATION_FAILED` on every reconnect.

### 3. `connection.ack.d.seq` is named nowhere — blocking

The resume anchor. Without it a client cannot compute the next `resumeFrom`,
cannot detect the over-cap gap, and cannot implement D2 at all. It appears in
no section of the PRD.

### 4. `message.send.d.type` is required but documented optional — blocking

§6.3 gives `opts?: { type?: MessageType }`. The server requires `type`. A
client following §6.3 omits it on every plain text message and every send
fails.

### 5. ULID format is never defined — blocking

§7.2 says the envelope `id` is a "ULID" and D1 says the server "validates ULID
format". Neither §7 nor the OpenAPI spec states the length, alphabet, case, or
time/random split. The accepted format is `^[0-9A-HJKMNP-TV-Z]{26}$` —
26 characters of uppercase Crockford base32, I/L/O/U excluded. From the spec
alone an implementer reaches for a UUID and every frame is refused.

Monotonicity within a millisecond is likewise unspecified. It is implemented
here because a host sorting its own un-acked optimistic messages by id would
otherwise see them reorder.

### 6. The gap-detection algorithm is one clause of prose

§0.4 row 2: over-cap "sends no replay plus the true `last_seq`, which the
client reads as one gap." Nothing says *how*. Two checks are required and only
one is discoverable: walking replayed frames finds holes between them, but the
over-cap case has no frames to walk — only the ack's own `seq` reveals the
span. A client that implements only the first check silently loses history.

### 7. The `resumeFrom`-ahead exchange is undocumented

Never-rewinding the anchor means a client ahead of the server keeps an
impossible anchor forever. The server handles it out of band: a standalone
`VALIDATION_FAILED` naming its own `seq`, **without closing the socket**. That
exchange appears in no section. A client that treats any `VALIDATION_FAILED` as
fatal tears down a healthy connection; one that ignores it never recovers.

### 8. Replay contents are unstated

The replay array holds `message.new` frames and nothing else — the server
builds it from message rows. An implementer reasonably writes a general applier
for any frame type. Harmless, but wasted work built on a guess.

### 9. `authenticating` has no timeout

§8.1 says the state ends on "`connection.ack` or `error`" and never bounds the
wait. A half-open connection through a NAT that dropped state — routine on
mobile — strands the client forever. A 10s timeout is imposed here; the value
is invented.

### 10. No heartbeat interval

§7.3 lists `system.heartbeat`/`system.pong`; v2 states no cadence and no
pong-timeout policy. 25s is used here, matching v1 (§12.11). See drift #3 for
why this matters less than it appears to.

### 11. `SuspendReason` cannot express the protocol-version case

§6.5 types it `'auth' | 'maxAttempts'`. §7.5 requires an unsupported protocol
version to surface as suspended, which is neither. (And `'maxAttempts'` can
only mean the auth cap, since transport retries are indefinite.)

### 12. Enum-value strictness is unstated

D4 says zero coercion, but nothing says what a client does with an
*unrecognised* enum value. Rejecting the frame is assumed here, by analogy with
unknown frame types.

---

## Spec-versus-server drift

### 1. Key prefixes — the spec documents prefixes the server no longer mints

PRD §6.1 and §10.1 say `dhpk_live_`/`dhpk_test_`, and the §6.4 amendment dated
2026-08-18 argues for them at length. **The server now mints only
`dhp_`/`dhk_`**; `dhpk_` is accepted during a deprecation window.

An implementer working from the PRD builds a validator that accepts `dhpk_` and
**rejects every key the system currently issues**. This client accepts `dhp_`
(current) and `dhpk_` (deprecated, flagged), and refuses `dhk_`/`dhsk_`/`sk_`
as secret keys.

Note also that `dhk_` is the **secret** prefix, not a publishable one — easy to
misread, and worth stating in §10.1 explicitly.

### 2. `message.markDelivered` / `message.delivered` are missing from §7.3

Both are implemented by the running server. Neither appears in either §7.3
table, although §0.4 open question 8 records the decision to add them
("Closing now"). A client that treats an unlisted `t` as a protocol violation
tears down a healthy connection the first time the server sends one. Decoded
and ignored here.

### 3. Liveness runs on protocol-level ping/pong, not on `system.heartbeat`

§7.3 lists `system.heartbeat`/`system.pong` and §12.11 describes v1's 25s
application ping, which together read as "heartbeat frames keep the socket
alive". They do not. The server reaps dead peers using **RFC 6455 protocol-level
ping/pong** on a 25s reaper tick, dropping anything that has not ponged since
the previous tick. `system.heartbeat` is merely echoed and plays no part.

Dart auto-answers control frames, so this client is fine without doing
anything. An implementer on a socket library that does not auto-pong would be
disconnected every 50 seconds while dutifully sending `system.heartbeat` and
reading §7.3 as the whole story. Protocol-level ping/pong is mentioned nowhere
in §7 or §8.

### 4. `replay` can be absent for reasons the spec does not admit

D2 frames replay as present-or-over-cap. The server also omits it when its own
access check, database read, or projection fails — still acking with a truthful
`seq`. It degrades into the same one-gap signal, so no special handling is
needed, but nothing says a replay may be absent for server-side reasons.

### 5. `connection.ack` carries a session the client never asked for

The server creates or resolves a session during the handshake and puts it in
the ack. §6.2 still models `joinSession` as an explicit step "kept as an
explicit step rather than assumed". Both are true at once; which one a client
should rely on is unclear.

---

## What was and was not run

**No Dart SDK is installed on this machine.** `dart` is not on `PATH`, there is
no `~/.pub-cache`, and the `flutter` shell function points at
`/Volumes/SSD/flutter/flutter/bin/flutter` on a volume that is not mounted.

Therefore **none of the following was executed**:

- `dart pub get` — dependencies were never resolved
- `dart analyze` — no type checking, no lint pass
- `dart test` — **every test in `test/` is unexecuted**
- `dart format` — formatting is by hand

The tests are written and complete, and the assertions encode the behaviour
described above, but *no claim is made that they pass*. Anyone with a Dart SDK
should run `dart pub get && dart analyze && dart test` in this directory first
and treat whatever falls out as the real starting point. Expect the analyzer to
find something.
