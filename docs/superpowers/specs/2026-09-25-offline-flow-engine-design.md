> **SUPERSEDED (2026-09-26).** This client-side flow runner was removed. Flows run on chat-service-node and the SDK never executes them (`chat-service-node/docs/specs/chatbot-workflows.md` §1, §11.3). See `docs/superpowers/specs/2026-09-26-flow-sdk-contract-design.md`. Kept for history only.

# Offline Flow Engine — Design

Status: approved in chat 2026-09-25, awaiting written-spec review.
Package: `packages/widget` (chatsupport-sdk). No change to `packages/core`, the wire protocol, or chat-service.

## 1. Problem

The console's Behaviour → Availability & privacy → "When you're closed" offers **Collect a message**, documented as "runs your out-of-hours bot flow so visitors can leave a message; falls back to showing the message if you haven't published one" (`OFFLINE_MODE_HINT`, WIDGET_CONFIG_SCHEMA §G).

The widget does not do this. `shouldCollectOffline(remote)` (remote-config.ts) always opens the built-in `createOfflineForm` (name / contact / message). `remote.flows` is parsed but never executed, so a merchant's OFFLINE flow (Chatbot → Flows, trigger 4) is ignored. The divergence is written down at remote-config.ts ("A KNOWN, DELIBERATE DIVERGENCE FROM THE CONSOLE CONTRACT"). This spec removes it.

## 2. Goal and scope

Goal: when the team is closed, `offlineMode === COLLECT_MESSAGE`, and a published + enabled OFFLINE flow exists, the widget runs that flow. Otherwise the built-in form appears (the console's documented fallback).

In scope: a step machine for the seven step kinds, its view, persistence, wiring, tests, removing the divergence note.

Out of scope: Welcome (1), Keyword (2), Page (3) triggers. The machine is trigger-agnostic; those triggers later need only a matching rule and a mount point.

Success criteria:
1. Closed + OFFLINE flow → flow runs step by step; every step kind behaves as in §5.
2. Closed + no OFFLINE flow → built-in form, unchanged.
3. Open, `followBusinessHours` off, `SHOW_MESSAGE`, `HIDE_WIDGET` → unchanged.
4. Malformed flow data never hangs or crashes the widget.
5. Answers reach chat-service so an agent sees them in the inbox.

## 3. Existing facts this design relies on

- Backend `GET /widget/config` already returns published+enabled flows as `PublicFlow { id, name, trigger, keywords, pagePattern, steps: unknown[] }`; `isOpenNow` is resolved per request. The widget never computes hours.
- `parseFlows` keeps `steps` as `unknown[]` ("the console's to evolve"). Step shapes are defined by the console's `BotStep` (`chatsupport-react/app/lib/settings/chatbot.ts`): `id, kind, text, saveAs?, choices?[{id,label,goToStepId}], variable?, operator? ("is"|"is not"|"contains"), value?, ifTrueStepId?, ifFalseStepId?, team?, tag?`. Step order in the array is the default "next".
- `store.client.sendMessage(text, { metadata })` and `store.client.requestAgent(reason?)` exist. `applyLocal` does **not** exist in core and is not added.
- The out-of-hours branch already replaces the composer with a widget-owned surface: `syncProductSurfaces` → `openSurface('offline', …)` (widget.ts). When a ticket destination exists (`entry.primary/secondary === 'ticket'`) it opens the web form instead; that precedence is unchanged.

## 4. Design

### 4.1 Selection

Add to remote-config.ts:

```ts
export function offlineFlowFor(remote: RemoteConfig): PublishedFlow | undefined
```

Returns the first flow in `remote.flows` with `trigger === 4` whose steps parse to at least one runnable step (array order, same tie-break the older spec uses for Welcome), or `undefined`. Only meaningful when `shouldCollectOffline(remote)` is true.

In `syncProductSurfaces`, the existing chain becomes:

```
ticketDestinationExists ? createWebformForm(...)
  : offlineFlow ? createFlowView(...)
  : createOfflineForm(...)
```

The flow branch never runs when a ticket destination exists.

### 4.2 Units

| File | Purpose | Depends on |
|---|---|---|
| `src/flow/parse.ts` | `parseFlowSteps(unknown[]) → FlowStep[]`. Defensive: drops entries that are not records or lack a string `id`/`kind`; unknown `kind` dropped; clamps text length; ignores unknown fields. Never throws. | nothing |
| `src/flow/machine.ts` | Pure, DOM-free step machine (see 4.3). Includes the three-operator condition evaluator. | `parse.ts` types |
| `src/ui/flow-view.ts` | The surface: mini transcript (bot lines, visitor replies), choice chips, text input for `question`, persistence, and the calls to `sendMessage` / `requestAgent`. | machine, `dom.ts`, `forms.ts` styles |
| `src/remote-config.ts` | `offlineFlowFor`; delete the divergence comment. | — |
| `src/widget.ts` | Mount the view in place of the built-in form; clear flow on agent/real-bot message. | flow-view |

`flow-view.ts` receives its side effects as callbacks (`send`, `requestAgent`, `hasSession`, `storage`) so it is testable without the store, the same style as `createOfflineForm`'s callbacks.

### 4.3 Machine

State: `{ flowId, stepId | null, answers: Record<string,string>, pendingTags: string[], done: boolean }`.

`start(steps) → { state, effects }`, `advance(steps, state, input?) → { state, effects }`. Effects (data, no side effects inside the machine):

- `say(text)` — render a bot line
- `ask(stepId, prompt)` — wait for typed text
- `choose(stepId, text, choices)` — show chips
- `send(text, metadata)` — outgoing message to chat-service
- `handoff(reason)` — request a person
- `done()`

Step semantics:

| Kind | Machine does |
|---|---|
| `message` | `say(text)`; advance to next in array order |
| `question` | `say(text)`, `ask`; on input: store under `saveAs` (if set), `send(answer, {kind:'offline_flow', flowId, stepId, tags?})`, advance |
| `choice` | `say(text)`, `choose`; on pick: `send(label, {…, choiceId})`; go to `choice.goToStepId` (`null` = end) |
| `condition` | No output. Compare `answers[variable]` to `value` with `is` / `is not` / `contains` (case-sensitive string compare, same as console); go to `ifTrueStepId` / `ifFalseStepId` (`null` = end). Missing variable compares as `""`. |
| `tag` | Push `tag` onto `pendingTags`; advance. Pending tags are attached as `metadata.tags` to the next `send`, then cleared. No empty message is ever sent. |
| `handoff` | `say(text)` if non-empty; `handoff(text)`; flow ends |
| end of array / `null` target | `done()` |

Guards:
- Hard cap of 100 steps executed per run. Hitting it ends the flow (`done`), so a cycle in flow data cannot freeze the widget.
- A `goToStepId` that matches no step id ends the flow.
- `question` input that is empty/whitespace is rejected in the view; the machine is not advanced.
- An empty parsed step list means "no usable flow"; `offlineFlowFor` callers fall back to the built-in form (checked in widget.ts by parsing once and testing length).

### 4.4 Data sent to chat-service

Every visitor answer/choice goes out as a normal message via `sendMessage`, with `metadata: { kind: 'offline_flow', flowId, stepId, choiceId?, tags? }`. The first such message creates the session exactly as the built-in form's `sendMessage` does today. Bot lines are **not** sent; they exist only in the view.

`handoff`: call `requestAgent(reason)` only if a session already exists (`hasSession()`); otherwise end the flow after showing the step's text. Rationale: with no session there is nothing to escalate, and the team is closed; a flow that asks a question first (the normal case) has a session by then.

Known limit (documented, not hidden): a `tag` step placed after the visitor's last message has no outgoing message to ride on and its tag is dropped. There is no server tag API.

### 4.5 Persistence and pre-emption

- localStorage key `chatsdk:<publishableKey>:offline-flow`, value `{ flowId, stepId, answers, pendingTags, sessionId | null }`. The older spec keyed by step index and session id; the flow's `goToStepId` branching makes the step **id** the correct cursor, and a closed-hours visitor may have no session yet.
- On mount: resume only if `flowId` equals the current published OFFLINE flow's id and the flow still has that `stepId`; otherwise discard and start fresh.
- Cleared on: `done`, handoff, a stored `sessionId` that differs from the current session, or an incoming `AGENT` message or real (non-local) `BOT` message (a person or real bot always wins). Wired through the existing message subscription in widget.ts.
- Every storage read/write is wrapped in try/catch; the flow works without storage.

### 4.6 Pre-chat fields

`preChatFields` are not added on this path. The flow's own `question` steps are the merchant's intake here. The built-in form keeps its pre-chat fields as today.

## 5. Error handling

| Situation | Behaviour |
|---|---|
| `sendMessage` rejects | Show the same inline error line style the offline form uses; do not advance; visitor can retry |
| Storage unavailable | Flow runs without resume |
| Config refresh mid-flow removes/changes the flow | On next surface sync, if `offlineFlowFor` changed id, discard state and rebuild |
| Team reopens mid-flow (`isOpenNow` → true) | `shouldCollectOffline` becomes false; existing surface teardown applies; state cleared |
| All steps dropped by the parser | Built-in form |

## 6. Testing

Unit (`test/flow-machine.test.ts`, `test/flow-parse.test.ts`): every step kind; condition operators incl. missing variable; tag attach-and-clear; cycle hits the cap; unknown `goToStepId`; empty list; each malformed-input class in the parser.

Widget (`test/offline-flow.test.ts`, in the style of `remote-config-gating.test.ts`): closed + OFFLINE flow renders bot line, chips, question input, and sends messages with the expected metadata; closed + no flow renders the built-in form; ticket destination still wins; resume after remount; agent message clears state; storage-throws case.

Regression: full widget suite, `tsc --noEmit`.

Manual, customer app: `pnpm pack:local` in the SDK, `npm run refresh:sdk` in the customer app, redeploy; set the Live chat calendar to closed; confirm flow runs and the agent sees answers in the inbox.

## 7. Risks

- Console may add step kinds later; the parser drops unknown kinds rather than failing (forward-compatible).
- Partial answers reach agents if a visitor abandons midway (accepted; matches the older spec).
- The customer app and any other host consume the SDK as tarballs, so the fix only reaches them after repack + refresh + redeploy.
