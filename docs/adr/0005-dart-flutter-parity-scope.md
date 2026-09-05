# ADR-0005 — What the Dart/Flutter SDK ports, what it does not, and why

- **Status:** Accepted 2026-09-05. Implemented across `packages/dart`, `packages/dart_rest`
  and `packages/flutter`.
- **Decision record:** the full per-decision log (D1–D47) lives in
  `~/.claude/plans/2026-09-04-1130-dart-parity.md`. This ADR records only the decisions a
  future engineer needs in order to read the code correctly.
- **Reference implementation:** `packages/widget` (17,228 LOC TypeScript).

## Context

`packages/widget` is a browser chat widget. This port brings the same product to Flutter
across three packages, deliberately split:

| Package | Job | Dependencies |
|---|---|---|
| `dhaam_chat` | §7 frame protocol, §8 connection state machine, §10 auth. **Pure Dart.** | `web_socket_channel` only |
| `dhaam_chat_rest` | The REST surface `dhaam_chat` deliberately does not speak. **Pure Dart.** | `dhaam_chat`, `http`, `http_parser` |
| `dhaam_chat_flutter` | The screens, the state container, the config fetch | both of the above, plus UI plugins |

The dependency direction is one-way and asserted by a test: **`dhaam_chat` imports nothing
from `dhaam_chat_rest`.** Its zero-HTTP boundary is the real constraint, and it is why
the REST layer is a separate package rather than a subdirectory.

## Decisions

### 1. `dhaam_chat_rest` DEPENDS on `dhaam_chat`, unlike the TypeScript split

`@dhaam-ccrm/rest` has a `no-core-import.test.ts` forbidding the equivalent import. That
invariant exists because `createChatClient` accepts five independently-substitutable
structural seams (`MessageHistorySource`, `AttachmentUploader`, `SessionActions`,
`SessionSummarySource`, `IdentitySync`) and `core` depends on nothing, so `rest` had to be
usable without `core`.

**Nothing in this workspace composes a Dart `ChatClient` and a REST layer behind such a
function.** The invariant therefore protects nothing on the Dart side, while enforcing it
would have cost: two incompatible `TokenProvider` types (so any host holding both clients
writes an adapter at every call site), a duplicated `PublishableKey.parse` carrying the
secret-key-in-client refusal, and parallel `ChatMessage`/`AttachmentMetadata` hierarchies
needing a translation layer in `packages/flutter`.

### 2. Deliberately NOT ported

Each of these is an answer to a question the Flutter host does not ask.

| Module | Why not | Flutter analogue |
|---|---|---|
| `embed.ts` | Script-tag entry, `document.currentScript`, `window.DhaamChat`. Exists to make "drop in a script tag" true. | `ChatWidget(config:)` in a widget tree |
| `attributes.ts` | `data-*` → config. Cannot even express `identity.profile` (nested object + array). | A typed Dart config object — strictly more expressive |
| `singleton.ts` | One widget per page across **separately-evaluated copies of the bundle**, via a `globalThis` string key. | Impossible in Dart — pub guarantees one copy. Multi-instance is the *normal* case in Flutter |
| `ui/dom.ts` | Element builder + SVG icon tables | Widgets + vector icons. **But `safeLinkUrl` is pure and IS ported** |
| `ui/focus.ts` | DOM focus trap; `offsetParent === null` is wrong for `position: fixed` | `FocusScope` / modal routes. `focus.test.ts` does not transfer |
| `ui/platform-color.ts` | Samples the **host page's** computed colours. There is no host page | `Theme.of(context)`, else the configured accent |
| `ui/presentation.ts` | bubble/sidebar/sheet — how a floating card coexists with a page we don't control | The host's own layout |
| `ui/styles.ts` | 2,816 lines of CSS in a template literal | The `theme/` layer |
| `ui/root.ts` | Shadow root, top layer, `popover="manual"`, z-index race | None — the Flutter package *is* the tree |
| **exit-intent** | Fires on `mouseout` with `relatedTarget === null && clientY <= 0` — a pointer leaving the document toward *browser chrome* | **Parsed and exposed; never acted on.** The widget already degrades it to `'never'` on touch devices, so omitting it is *behaviourally identical to the web widget on the same class of device* |

`auto-open: 'delay'` and `greetingDelaySec` **are** ported, as `Timer`s with the
one-shot + re-check-at-fire discipline.

### 3. `mergeRemoteConfig`'s host-precedence is NOT ported

The console publish is the single source of truth for appearance on Flutter. A Flutter
host cannot pin an appearance field against a publish. This is a deliberate divergence,
not an omission.

### 4. Two caps on a reply excerpt, because they are two obligations

`kReplyExcerptContract` (120) is what this client **promises to send**.
`kMaxQuoteExcerpt` (160) is what it **tolerates receiving**, chosen wider precisely
because a peer might ignore the promise.

Producing against the tolerance is how a tolerance quietly becomes the contract. The two
constants are not duplication and must not be merged.

### 5. `SendFailureReason` ships two values, not the TypeScript's five

`rejected` and `sessionClosed` are the two this client can actually produce. `expired`,
`evicted` and `storage` all require offline-queue features (§9.6 retention, §9.1
persistence) that Dart's in-memory `_outbox` does not have.

A test asserts `SendFailureReason.values` has exactly two, so **adding a dead state is a
red test rather than a silent unreachable renderer branch.** Each absent value is
documented with the precise queue feature that would make it reachable.

### 6. `MessageDelivery` has no `failed` constant

`pending`, `confirmed` and `queued` survive as canonical `static const` instances. There
is deliberately **no `MessageDelivery.failed`** beside them: the missing constant is what
makes the compiler demand a reason and a verdict at every failure site. That asymmetry is
the §6.4 invariant, made visible at the call site.

### 7. `TicketLinked.ticketUrl` accepts null — the TypeScript validator is the one out of step

`validateTicketLinked` demands `isNonEmptyString`. `openapi/chat-api.yaml`'s `Ticket`
schema, which names this frame directly, declares `url: type: [string, "null"]`. Null is
contract-legal, so tightening would drop a valid frame and lose the ticket id with it.
Pinned by a Dart test so nobody "fixes" it in the wrong direction.

### 8. Prototype-pollution stripping is not ported; URL-scheme validation is

`projection.ts` strips `__proto__`, `constructor` and `prototype` from a message's
metadata bag, defending against a JavaScript-specific fact: `JSON.parse` makes
`__proto__` an own property. `jsonDecode` yields a plain `Map` with no prototype chain, so
there is no vulnerability class here to close — and a test asserts those keys **survive as
ordinary data**, so any future Dart-side reason to strip them forces the conversation
rather than being an accident.

`isAttachmentMetadata`'s `http:`/`https:` allowlist **is** ported: that is a general "do
not render an attacker-chosen URL because a `mediaType` claims it is an image" rule.

## Known gaps, recorded rather than implied by silence

1. **No independent review pass ran.** REVIEW (`code-reviewer` + `security-auditor` +
   `performance-engineer`) was skipped at the user's instruction. Roughly 11k lines of new
   Dart carry per-node self-review only. Two areas would most repay an outside look:
   `dhaam_chat_rest`'s auth path (both credentials on every request, beside a deliberately
   *unauthed* `ip-watermark` route), and `csat.dart`'s concurrency (an in-flight lookup
   racing a local write — its own author asked for a reviewer pass on it).
2. **`packages/binding-conformance` has no Dart analogue.** Its ~18 assertions guard every
   JS binding against drift; `ChatWidgetCubit` is an unguarded binding.
3. **`ChatClientAdapter` has one tested delegation of fourteen.** The retry path is
   covered; the other thirteen are guarded only by the type checker. This was found by
   mutation — hardcoding `adapter.retry` to a refusal left the whole suite green — and the
   adapter is the *only* path from a live `ChatClient` to the widget layer.
4. **Consent does not gate the offline form's submit.** Faithful to the reference (which
   gates only `.dh-input`), but an out-of-hours message can be sent without agreeing to the
   notice, and sending is what creates the record. Arguably a gap in the reference itself.
5. **The inline `.dh-report-open` entry point (`widget.ts:1401`) is not ported.** The
   header-menu entry is. The second one changes the screen's layout.
6. **`COLLECT_MESSAGE` flows are not implemented.** The console specifies it as "run the
   tenant's OFFLINE-trigger bot flow, falling back to a form"; neither the widget nor this
   port implements the step machine. `PublishedFlow.steps` stays opaque, as the widget
   treats it.
7. **`SessionPickerScreen` has no library call site** and looks like supersession rather
   than a gap — Home and Messages read `state.sessionSummaries` directly. Probably dead
   code to delete.

## Consequences

**The process finding worth carrying forward:** seven subsystems in this port reached
"complete, tested, and referenced from zero library files" — attachments, chime, contact
info, Retry, report-issue, voice, and the session switcher. Every one had passing unit
tests. The cause was uniform: **a task that says "build X" does not thereby say "and mount
it"**, and a widget test proves a widget works without proving anyone can reach it.

Two habits caught these where test suites did not: building a runnable example app (which
found that `captureContactInfo` had nowhere to deliver — a producer with no consumer, in a
package whose own tests all passed), and mutation-testing the mount rather than the module
(deleting the `isHandledByCurrent` gate turned five tests red, but **only** the mount test
caught it; four component tests stayed green against an app bar that never called the
function).
