# Flow SDK Part 2 (visitor events, invites, commerce cards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side support in `chatsupport-sdk` (`packages/core`, `packages/widget`) and wiring in `dh-hyperlocal-customer-app-react` for three backend-already-built WebSocket frames (`visitor.event`, `flow.invite`, `flow.inviteDismissed`) and for rendering `metadata.discount`/`metadata.products`/`metadata.order` on bot messages.

**Architecture:** `packages/core` grows the wire-protocol catalog (frame types, payload shapes, validators), a business-rule normalizer that mirrors the server's own per-event prop rules, a latch on the connection hello for accepting an invite, and three new `ChatClient` methods plus two new `ChatEventMap` entries. `packages/widget` consumes that surface: a new invite-bubble UI component, three new commerce-card renderers in the message list, a public `sendEvent`/`dismissInvite` API on `ChatWidget` and `DhaamChatGlobal`, and one edit to the existing exit-intent detector. `dh-hyperlocal-customer-app-react`'s existing `analyticsMiddleware` grows three more branches that call `widget.sendEvent(...)` alongside its existing `dispatchEvent(...)` calls.

**Tech Stack:** TypeScript, vitest (both `chatsupport-sdk` packages and `dh-hyperlocal-customer-app-react` use vitest), vanilla DOM (no React) in `packages/widget`, Redux Toolkit middleware in the customer app.

**Spec:** `chatsupport-sdk/docs/superpowers/specs/2026-09-28-flow-sdk-part2-design.md` (this plan implements it in full; read it alongside this plan). Part 1's conventions are documented in `chatsupport-sdk/docs/superpowers/specs/2026-09-26-flow-sdk-contract-design.md`.

## Global Constraints

- Backend wire contract is already fully implemented in `chat-service-node` — do not modify any file under `chat-service-node/`.
- Exactly 4 visitor event names are built now: `search`, `cart_updated`, `exit_intent`, `product_viewed`. `checkout_error` and `custom` are valid on the wire (`VISITOR_EVENT_NAMES` has 6 entries) but no template reads them yet — not built now (YAGNI). The client-side normalizer treats them as unrecognised, same as any other unknown name.
- `metadata.products` renders at most 3 cards, client-side, regardless of how many the server sent.
- No `onAction` — cards are read-only display. The existing button/`metadata.buttons` mechanism already covers a flow needing a choice (e.g. "Yes please/No thanks").
- No personal data in event `props` — same rule as Part 1's `attributes`; the server's own `EVENT_PROPS` allow-list backstops this regardless.
- Every new client entry point (`sendVisitorEvent`, `acceptInvite`, `dismissInvite`, `ChatWidget.sendEvent`/`.dismissInvite`, `DhaamChat.sendEvent`/`.dismissInvite`) never throws: malformed input is dropped with a `logger.warn`/`onError` call, exactly Part 1's `setPageContext` contract.
- No HTML anywhere in the widget — every string reaches the DOM through `textContent`/`el()`'s `text` option, never `innerHTML`.
- The widget's existing exit-intent `mouseout` detector (`widget.ts`'s `armAutoOpen`) fires both the existing auto-open and the new visitor event from the same listener — never a second `document.addEventListener('mouseout', …)`.
- `flow.invite.autoOpen: true` skips the bubble entirely and opens the panel directly.
- The legacy `chatsupport-sdk/src/widget/*.tsx` React tree is not part of the pnpm workspace build — do not read, reference, or touch it.
- `packages/core` has zero runtime dependencies (no zod/ajv) and zero DOM/`window`/`document` references outside `storage/browser.ts` — every new core module is hand-rolled and platform-agnostic, matching `protocol/validate.ts`'s and `protocol/visitor-context.ts`'s own header comments.

## Review Focus

- **Malformed/oversized event props from a compromised or buggy page script** — e.g. `sendEvent('cart_updated', { items: -5, value: 'free' })`. Expected: the whole event is dropped (never sent), a `logger.warn` fires, and nothing throws. Pinned in Task 3 (`visitor-event.test.ts`) and Task 6 (`client/visitor-event.test.ts`).
- **`sendEvent`/`sendVisitorEvent` called before the widget/client is connected yet** — e.g. a route fires `product_viewed` while the very first hello is still in flight. Expected: the frame is dropped (the transport resolves `'disconnected'`), never queued for later delivery (unlike `message.send`'s durable queue), and the call never throws or blocks the pending `connect()`. Pinned in Task 6.
- **Two `cart_updated` events firing in the same tick** (a rapid double add-to-cart click). Expected: each is sent as its own distinct frame — visitor events do not coalesce or dedupe the way `context.update` does, because each is a discrete fact rather than a single current value. Pinned in Task 6 and Task 13.
- **An invite pushed for a connection that then disconnects/navigates away/is destroyed before the visitor accepts it.** Expected: no crash, and no listener left firing into a torn-down widget — the invite-bubble's `flowInvite`/`flowInviteCleared` subscriptions live in the same `unsubscribers` array every other store subscription does, torn down on `destroy()`. Pinned in Task 9.
- **`metadata.discount`/`metadata.products`/`metadata.order` missing expected fields** — a product with no `id`, an order with no `statusLabel`, a discount with an empty `code`. Expected: that one field/item is skipped defensively; a metadata bag with nothing usable renders no card at all rather than an empty or broken one, and nothing throws. Pinned in Task 11 (`flow-cards.test.ts`) and Task 12.

---

## Task 1 (core): Protocol frame catalog

**Files:**
- Modify: `packages/core/src/protocol/frames.ts:38-53` (VisitorContext/ContextUpdatePayload area, new payload types go right after), `:55-212` (`ConnectionHelloPayload`, add `inviteId?`), `:659-747` (catalog arrays and payload maps)
- Modify: `packages/core/src/protocol/frames.test.ts` (catalog counts, exhaustive switch)
- Modify: `packages/core/src/protocol/index.ts:60-104` (barrel exports)
- Test: `packages/core/src/protocol/frames.test.ts`

**Interfaces:**
- Produces: `VisitorEventName`, `VISITOR_EVENT_NAMES`, `VisitorEventPayload { name: VisitorEventName; props?: Record<string, string|number|boolean> }`, `FlowInviteDismissedPayload { inviteId: string }`, `FlowInvitePayload { inviteId: string; text: string; buttons?: {id:string;label:string}[]; autoOpen?: true }`, `ConnectionHelloPayload.inviteId?: string`. `CLIENT_TO_SERVER_FRAME_TYPES` gains `'visitor.event'`, `'flow.inviteDismissed'`. `SERVER_PUSH_FRAME_TYPES` gains `'flow.invite'`. `ClientFramePayloadMap`/`ServerPushFramePayloadMap` gain matching entries.
- Consumes: nothing new (foundational task).

- [ ] **Step 1: Write the failing catalog-count test**

Edit `packages/core/src/protocol/frames.test.ts`, replacing the two `expect(...).toEqual([...])` arrays and the distinct-count assertion:

```ts
  it('has exactly the 16 client→server frame types', () => {
    expect(CLIENT_TO_SERVER_FRAME_TYPES).toEqual([
      'connection.hello',
      'connection.reauth',
      'session.join',
      'session.leave',
      'session.requestAgent',
      'message.send',
      'message.markRead',
      'message.markDelivered',
      'typing.start',
      'typing.stop',
      'presence.set',
      'presence.query',
      'system.heartbeat',
      'context.update',
      'visitor.event',
      'flow.inviteDismissed',
    ]);
  });

  it('has exactly the 14 plain server push frame types (excludes ack/error)', () => {
    expect(SERVER_PUSH_FRAME_TYPES).toEqual([
      'connection.ack',
      'session.updated',
      'session.closed',
      'agent.joined',
      'agent.left',
      'message.new',
      'typing.start',
      'typing.stop',
      'message.read',
      'message.delivered',
      'presence.update',
      'ticket.linked',
      'flow.invite',
      'system.pong',
    ]);
    expect(SERVER_PUSH_FRAME_TYPES).not.toContain('ack');
    expect(SERVER_PUSH_FRAME_TYPES).not.toContain('error');
  });
```

And the distinct-count test:

```ts
  it('has 30 distinct frame type strings total (typing.start/stop shared, not double-counted)', () => {
    const distinct = new Set(ALL_FRAME_TYPES);
    expect(distinct.size).toBe(30);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @dhaam-ccrm/core test frames.test.ts`
Expected: FAIL — the arrays don't match yet (frame types not added), and `describeFrame`'s exhaustive switch will also fail to typecheck once Step 5 adds cases without matching frame types existing yet, so run this step before Step 5's edits.

- [ ] **Step 3: Add the new payload types to frames.ts**

In `packages/core/src/protocol/frames.ts`, right after the `ContextUpdatePayload` interface (around line 53), add:

```ts
export const VISITOR_EVENT_NAMES = [
  'search',
  'cart_updated',
  'exit_intent',
  'product_viewed',
  'checkout_error',
  'custom',
] as const;
export type VisitorEventName = (typeof VISITOR_EVENT_NAMES)[number];

/**
 * `visitor.event` (chatbot-workflows-commerce.md §4). Not a message: never
 * stored, never in the transcript. Field-for-field
 * chat-service-node's `VisitorEventPayload` (protocol/types.ts). Build one
 * with `normalizeVisitorEvent` (visitor-event.ts), which drops anything the
 * server would silently discard — see that module for which of the 6 names
 * above this SDK actually sends today.
 */
export interface VisitorEventPayload {
  name: VisitorEventName;
  /** At most 12 keys of scalars, strings at most 200; per-event rules in visitor-event.ts. */
  props?: Record<string, string | number | boolean>;
}

/** `flow.inviteDismissed` (chatbot-workflows-commerce.md §6). */
export interface FlowInviteDismissedPayload {
  inviteId: string;
}

/**
 * `flow.invite`, server → client (chatbot-workflows-commerce.md §6): a flow
 * would like to start and there is no chat yet.
 */
export interface FlowInvitePayload {
  inviteId: string;
  text: string;
  buttons?: { id: string; label: string }[];
  /** The flow is set to "Open the chat and start" (Amendment D). */
  autoOpen?: true;
}
```

Then add `inviteId` to `ConnectionHelloPayload`, right after `newSession?: boolean;` (around line 145):

```ts
  /**
   * Accepts a server-pushed `flow.invite` (chatbot-workflows-commerce.md §6):
   * carries the invite forward onto the hello that follows
   * `client.acceptInvite(inviteId)`. Set only by that method, latched the
   * same way `subject`/`topic` are, and cleared once an ack confirms a hello
   * carried it — see `ConnectionController.carryInvite`'s doc.
   */
  inviteId?: string;
```

- [ ] **Step 4: Add the catalog entries**

In `packages/core/src/protocol/frames.ts`, edit `CLIENT_TO_SERVER_FRAME_TYPES` (around line 659):

```ts
export const CLIENT_TO_SERVER_FRAME_TYPES = [
  'connection.hello',
  'connection.reauth',
  'session.join',
  'session.leave',
  'session.requestAgent',
  'message.send',
  'message.markRead',
  'message.markDelivered',
  'typing.start',
  'typing.stop',
  'presence.set',
  'presence.query',
  'system.heartbeat',
  'context.update',
  'visitor.event',
  'flow.inviteDismissed',
] as const;
```

Edit `SERVER_PUSH_FRAME_TYPES` (around line 683):

```ts
export const SERVER_PUSH_FRAME_TYPES = [
  'connection.ack',
  'session.updated',
  'session.closed',
  'agent.joined',
  'agent.left',
  'message.new',
  'typing.start',
  'typing.stop',
  'message.read',
  'message.delivered',
  'presence.update',
  'ticket.linked',
  'flow.invite',
  'system.pong',
] as const;
```

Edit `ClientFramePayloadMap` (around line 716), adding after `'context.update': ContextUpdatePayload;`:

```ts
  'visitor.event': VisitorEventPayload;
  'flow.inviteDismissed': FlowInviteDismissedPayload;
```

Edit `ServerPushFramePayloadMap` (around line 733), adding after `'ticket.linked': TicketLinkedPayload;`:

```ts
  'flow.invite': FlowInvitePayload;
```

- [ ] **Step 5: Update the exhaustive-narrowing test**

In `packages/core/src/protocol/frames.test.ts`'s `describeFrame` function, add three cases (placed to match the catalog: `visitor.event`/`flow.inviteDismissed` near `context.update`, `flow.invite` near `ticket.linked`):

```ts
    case 'context.update':
      return `contextUpdate:${frame.d.label ?? ''}`;
    case 'visitor.event':
      return `visitorEvent:${frame.d.name}`;
    case 'flow.inviteDismissed':
      return `inviteDismissed:${frame.d.inviteId}`;
```

and:

```ts
    case 'ticket.linked':
      return `ticketLinked:${frame.d.ticketId}`;
    case 'flow.invite':
      return `flowInvite:${frame.d.inviteId}:${frame.d.autoOpen ?? false}`;
```

Add assertions exercising the new cases inside the existing `it('narrows every client→server frame type correctly', ...)` and `it('narrows every server→client push frame type correctly', ...)` blocks:

```ts
    expect(
      describeFrame({
        v: 1,
        t: 'visitor.event',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: { name: 'exit_intent', props: {} },
      }),
    ).toBe('visitorEvent:exit_intent');
```

```ts
    expect(
      describeFrame({
        v: 1,
        t: 'flow.invite',
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts: 1,
        d: { inviteId: 'inv_1', text: 'Need a hand?' },
      }),
    ).toBe('flowInvite:inv_1:false');
```

- [ ] **Step 6: Export the new types from the protocol barrel**

In `packages/core/src/protocol/index.ts`, add to the `export type { ... } from './frames.js';` block (around line 68-104):

```ts
  VisitorEventPayload,
  VisitorEventName,
  FlowInviteDismissedPayload,
  FlowInvitePayload,
```

and add `VISITOR_EVENT_NAMES` to the `export { CLIENT_TO_SERVER_FRAME_TYPES, ... } from './frames.js';` block (around line 62-67):

```ts
export {
  CLIENT_TO_SERVER_FRAME_TYPES,
  SERVER_PUSH_FRAME_TYPES,
  SERVER_TO_CLIENT_FRAME_TYPES,
  ALL_FRAME_TYPES,
  VISITOR_EVENT_NAMES,
} from './frames.js';
```

- [ ] **Step 7: Run the tests to confirm they pass**

Run: `pnpm --filter @dhaam-ccrm/core test frames.test.ts`
Expected: PASS. Also run `pnpm --filter @dhaam-ccrm/core typecheck` — this is what actually proves the exhaustive-narrowing `never` check still holds.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/protocol/frames.ts packages/core/src/protocol/frames.test.ts packages/core/src/protocol/index.ts
git commit -m "feat(core): add visitor.event/flow.invite/flow.inviteDismissed to the frame catalog"
```

---

## Task 2 (core): Frame validators

**Files:**
- Modify: `packages/core/src/protocol/validate.ts:379-437` (`validateConnectionHello`), `:673-701` (`PAYLOAD_VALIDATORS`)
- Test: `packages/core/src/protocol/validate.test.ts`

**Interfaces:**
- Consumes: `VisitorEventPayload`, `FlowInviteDismissedPayload`, `FlowInvitePayload`, `ConnectionHelloPayload.inviteId` (Task 1).
- Produces: `validateFrame`/`isFrame` now accept well-formed `visitor.event`, `flow.inviteDismissed`, `flow.invite` frames and a hello carrying `inviteId`. These are **shape guards only** (matching `validateContextUpdate`'s own doc: business rules live in the normalizer, Task 3) — do not re-implement `EVENT_PROPS` here.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/protocol/validate.test.ts`'s `describe('validateFrame — valid frames of every type pass', ...)` array (in the `validFrames` list, anywhere — order doesn't matter to `it.each`):

```ts
    [
      'visitor.event',
      { v: 1, t: 'visitor.event', id: ULID_A, ts: TS, d: { name: 'exit_intent' } },
    ],
    [
      'visitor.event with props',
      { v: 1, t: 'visitor.event', id: ULID_A, ts: TS, d: { name: 'cart_updated', props: { items: 2 } } },
    ],
    [
      'flow.inviteDismissed',
      { v: 1, t: 'flow.inviteDismissed', id: ULID_A, ts: TS, d: { inviteId: 'inv_1' } },
    ],
    [
      'flow.invite',
      { v: 1, t: 'flow.invite', id: ULID_A, ts: TS, d: { inviteId: 'inv_1', text: 'Need a hand?' } },
    ],
    [
      'flow.invite with buttons and autoOpen',
      {
        v: 1,
        t: 'flow.invite',
        id: ULID_A,
        ts: TS,
        d: { inviteId: 'inv_1', text: 'Need a hand?', buttons: [{ id: 'b1', label: 'Yes' }], autoOpen: true },
      },
    ],
    [
      'connection.hello with inviteId',
      {
        v: 1,
        t: 'connection.hello',
        id: ULID_A,
        ts: TS,
        d: { token: 'tok', publishableKey: 'dhp_test_1', protocolVersion: 1, inviteId: 'inv_1' },
      },
    ],
```

Add a new `describe` block for the malformed cases:

```ts
describe('validateFrame — visitor.event / flow.invite / flow.inviteDismissed rejected with a useful reason', () => {
  it('rejects visitor.event with no name', () => {
    const result = validateFrame({ v: 1, t: 'visitor.event', id: ULID_A, ts: TS, d: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.name');
  });

  it('rejects flow.inviteDismissed with no inviteId', () => {
    const result = validateFrame({ v: 1, t: 'flow.inviteDismissed', id: ULID_A, ts: TS, d: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.inviteId');
  });

  it('rejects flow.invite with no text', () => {
    const result = validateFrame({
      v: 1,
      t: 'flow.invite',
      id: ULID_A,
      ts: TS,
      d: { inviteId: 'inv_1' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.text');
  });

  it('rejects flow.invite whose button is missing a label', () => {
    const result = validateFrame({
      v: 1,
      t: 'flow.invite',
      id: ULID_A,
      ts: TS,
      d: { inviteId: 'inv_1', text: 'hi', buttons: [{ id: 'b1' }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('d.buttons[0].label');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @dhaam-ccrm/core test validate.test.ts`
Expected: FAIL — `'visitor.event'`/`'flow.inviteDismissed'`/`'flow.invite'` are not yet in `PAYLOAD_VALIDATORS`, so `validateFrame` currently rejects even the well-formed cases with `unknown frame type` (they *are* in `ALL_FRAME_TYPES` from Task 1, so it will instead throw a runtime error reading `PAYLOAD_VALIDATORS[t]` — confirm the failure, whatever its exact message, before moving on).

- [ ] **Step 3: Implement the validators**

In `packages/core/src/protocol/validate.ts`, add after `validateContextUpdate` (around line 475):

```ts
function validateVisitorEvent(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'name', isNonEmptyString, path, 'a non-empty string', frameType) ??
    optionalField(d, 'props', isPlainObject, path, 'an object', frameType)
  );
}

function validateFlowInviteDismissed(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return requireField(d, 'inviteId', isNonEmptyString, path, 'a non-empty string', frameType);
}

function validateFlowInviteButton(value: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(value)) return fail(path, 'must be an object', frameType);
  return (
    requireField(value, 'id', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(value, 'label', isNonEmptyString, path, 'a non-empty string', frameType)
  );
}

function validateFlowInvite(d: unknown, path: string, frameType: string): FrameValidationFailure | null {
  if (!isPlainObject(d)) return fail(path, 'must be an object', frameType);
  return (
    requireField(d, 'inviteId', isNonEmptyString, path, 'a non-empty string', frameType) ??
    requireField(d, 'text', isString, path, 'a string', frameType) ??
    optionalArray(d, 'buttons', path, validateFlowInviteButton, frameType) ??
    optionalField(d, 'autoOpen', isBoolean, path, 'a boolean', frameType)
  );
}
```

Edit `validateConnectionHello` (around line 435), appending one more optional field before the closing `);`:

```ts
    optionalField(d, 'geo', isGeoCoordinates, path, 'an object with numeric lat/lng in range', frameType) ??
    // Accepts an invite (chatbot-workflows-commerce.md §6) — see
    // ConnectionHelloPayload.inviteId's doc.
    optionalField(d, 'inviteId', isNonEmptyString, path, 'a non-empty string', frameType)
  );
```

Register the three new validators in `PAYLOAD_VALIDATORS` (around line 673-701), adding after `'context.update': validateContextUpdate,`:

```ts
  'visitor.event': validateVisitorEvent,
  'flow.inviteDismissed': validateFlowInviteDismissed,
```

and after `'ticket.linked': validateTicketLinked,`:

```ts
  'flow.invite': validateFlowInvite,
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @dhaam-ccrm/core test validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/protocol/validate.ts packages/core/src/protocol/validate.test.ts
git commit -m "feat(core): validate visitor.event/flow.invite/flow.inviteDismissed frame shapes"
```

---

## Task 3 (core): Visitor event business-rule normalizer

**Files:**
- Create: `packages/core/src/protocol/visitor-event.ts`
- Modify: `packages/core/src/protocol/index.ts` (export `normalizeVisitorEvent`)
- Test: `packages/core/src/protocol/visitor-event.test.ts`

**Interfaces:**
- Consumes: `VisitorEventName`, `VisitorEventPayload` (Task 1).
- Produces: `normalizeVisitorEvent(name: unknown, props: unknown): VisitorEventPayload | null` — Task 6's `client.sendVisitorEvent` is the sole caller.

This mirrors `chat-service-node/src/application/flows/facts.ts:155-203`'s `EVENT_PROPS`/`boundEvent` field-for-field for the 4 built event names, exactly the way `visitor-context.ts` mirrors the server's `parseVisitorContext`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/protocol/visitor-event.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeVisitorEvent } from './visitor-event.js';

describe('normalizeVisitorEvent — the 4 built events', () => {
  it('search: keeps query and results when both are present and valid', () => {
    expect(normalizeVisitorEvent('search', { query: 'blue shoes', results: 0 })).toEqual({
      name: 'search',
      props: { query: 'blue shoes', results: 0 },
    });
  });

  it('search: drops the whole event when results is missing (server-required)', () => {
    expect(normalizeVisitorEvent('search', { query: 'blue shoes' })).toBeNull();
  });

  it('search: drops the whole event when query is blank', () => {
    expect(normalizeVisitorEvent('search', { query: '  ', results: 3 })).toBeNull();
  });

  it('cart_updated: keeps items, drops an invalid value, currency is upper-cased', () => {
    expect(normalizeVisitorEvent('cart_updated', { items: 2, value: 999, currency: 'inr' })).toEqual({
      name: 'cart_updated',
      props: { items: 2, value: 999, currency: 'INR' },
    });
  });

  it('cart_updated: drops the whole event when items is missing (server-required)', () => {
    expect(normalizeVisitorEvent('cart_updated', { value: 100 })).toBeNull();
  });

  it('cart_updated: drops a negative items count', () => {
    expect(normalizeVisitorEvent('cart_updated', { items: -5, value: 'free' })).toBeNull();
  });

  it('cart_updated: drops an unrecognised currency without failing the whole event', () => {
    expect(normalizeVisitorEvent('cart_updated', { items: 1, currency: 'not-a-currency' })).toEqual({
      name: 'cart_updated',
      props: { items: 1 },
    });
  });

  it('exit_intent: has no props at all, and none are required', () => {
    expect(normalizeVisitorEvent('exit_intent', {})).toEqual({ name: 'exit_intent', props: {} });
    expect(normalizeVisitorEvent('exit_intent', undefined)).toEqual({ name: 'exit_intent', props: {} });
  });

  it('product_viewed: keeps productId and inStock', () => {
    expect(normalizeVisitorEvent('product_viewed', { productId: 'prod_1', inStock: true })).toEqual({
      name: 'product_viewed',
      props: { productId: 'prod_1', inStock: true },
    });
  });

  it('product_viewed: drops the whole event when productId is missing (server-required)', () => {
    expect(normalizeVisitorEvent('product_viewed', { inStock: true })).toBeNull();
  });
});

describe('normalizeVisitorEvent — not built yet (YAGNI) and malformed input', () => {
  it('rejects checkout_error and custom — valid on the wire, not built now', () => {
    expect(normalizeVisitorEvent('checkout_error', {})).toBeNull();
    expect(normalizeVisitorEvent('custom', { event: 'anything' })).toBeNull();
  });

  it('rejects an unrecognised name outright', () => {
    expect(normalizeVisitorEvent('made_up_event', {})).toBeNull();
  });

  it('rejects a non-string name', () => {
    expect(normalizeVisitorEvent(42, {})).toBeNull();
    expect(normalizeVisitorEvent(null, {})).toBeNull();
  });

  it('rejects props that is not an object', () => {
    expect(normalizeVisitorEvent('exit_intent', 'nope')).toBeNull();
    expect(normalizeVisitorEvent('exit_intent', ['a'])).toBeNull();
  });

  it('never throws on any input', () => {
    expect(() => normalizeVisitorEvent(undefined, undefined)).not.toThrow();
    expect(() => normalizeVisitorEvent({}, {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @dhaam-ccrm/core test visitor-event.test.ts`
Expected: FAIL with "Cannot find module './visitor-event.js'".

- [ ] **Step 3: Implement the normalizer**

Create `packages/core/src/protocol/visitor-event.ts`:

```ts
// `client.sendVisitorEvent(name, props)`'s business-rule check
// (chatbot-workflows-commerce.md §4) — is this one of the events this SDK
// sends today, and are its props the server will actually keep?
//
// Mirrors chat-service-node's own `EVENT_PROPS`/`boundEvent`
// (application/flows/facts.ts:155-203) so this client never sends what the
// server would silently drop — same "don't waste a frame" reasoning as
// `context.update`'s coalescing, and the same normalize-on-the-way-out
// pattern as `visitor-context.ts`.
//
// `checkout_error` and `custom` are valid VisitorEventNames on the wire
// (frames.ts's VISITOR_EVENT_NAMES has 6 entries) but no flow template reads
// them yet, so they are deliberately NOT built here (YAGNI) — treated exactly
// like any other unrecognised name until a caller needs them.

import type { VisitorEventName, VisitorEventPayload } from './frames.js';

type PropKind = 'text' | 'count' | 'amount' | 'flag' | 'currency' | 'id';
interface PropRule {
  readonly key: string;
  readonly kind: PropKind;
  readonly max?: number;
  readonly required?: boolean;
}

const MAX_STRING = 200;
const MAX_ID = 80;
const CURRENCY_RE = /^[A-Z]{3}$/;

/** The 4 events this SDK sends today, and the props each may carry. */
const EVENT_PROPS: Record<string, readonly PropRule[]> = {
  search: [
    { key: 'query', kind: 'text', max: MAX_STRING, required: true },
    { key: 'results', kind: 'count', required: true },
  ],
  cart_updated: [
    { key: 'items', kind: 'count', required: true },
    { key: 'value', kind: 'amount' },
    { key: 'currency', kind: 'currency' },
  ],
  exit_intent: [],
  product_viewed: [
    { key: 'productId', kind: 'id', required: true },
    { key: 'inStock', kind: 'flag' },
    { key: 'price', kind: 'amount' },
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propValue(rule: PropRule, v: unknown): string | number | boolean | undefined {
  switch (rule.kind) {
    case 'text':
      return typeof v === 'string' && v.trim() !== '' ? v.slice(0, rule.max ?? MAX_STRING) : undefined;
    case 'count':
      return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : undefined;
    case 'amount':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
    case 'flag':
      return typeof v === 'boolean' ? v : undefined;
    case 'currency': {
      const upper = typeof v === 'string' ? v.trim().toUpperCase() : '';
      return CURRENCY_RE.test(upper) ? upper : undefined;
    }
    case 'id':
      return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID ? v : undefined;
  }
}

/**
 * `client.sendVisitorEvent(name, props)`'s validation: `null` for anything
 * this SDK does not send today (an unrecognised name, or a recognised one
 * missing a required prop) — the same "drop the whole event" rule the
 * server's own `boundEvent` applies, so a call that would be silently
 * discarded server-side is never sent at all.
 */
export function normalizeVisitorEvent(name: unknown, props: unknown): VisitorEventPayload | null {
  if (typeof name !== 'string' || !Object.hasOwn(EVENT_PROPS, name)) return null;
  const input = props === undefined || props === null ? {} : props;
  if (!isPlainObject(input)) return null;

  const kept: [string, string | number | boolean][] = [];
  for (const rule of EVENT_PROPS[name]!) {
    const value = propValue(rule, input[rule.key]);
    if (value !== undefined) kept.push([rule.key, value]);
    else if (rule.required) return null;
  }

  return { name: name as VisitorEventName, props: Object.fromEntries(kept) };
}
```

- [ ] **Step 4: Export it from the protocol barrel**

In `packages/core/src/protocol/index.ts`, add near `export { normalizeVisitorContext, visitorContextKey } from './visitor-context.js';`:

```ts
export { normalizeVisitorEvent } from './visitor-event.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter @dhaam-ccrm/core test visitor-event.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/protocol/visitor-event.ts packages/core/src/protocol/visitor-event.test.ts packages/core/src/protocol/index.ts
git commit -m "feat(core): normalizeVisitorEvent — client-side EVENT_PROPS mirror"
```

---

## Task 4 (core): `flowInvite`/`flowInviteCleared` events

**Files:**
- Modify: `packages/core/src/state/events.ts`
- Test: `packages/core/src/state/events.test.ts`

**Interfaces:**
- Consumes: `FlowInvitePayload` (Task 1).
- Produces: `ChatEventMap.flowInvite: FlowInvitePayload`, `ChatEventMap.flowInviteCleared: { inviteId: string }`. Task 6's `dispatchFrame`/`acceptInvite`/`dismissInvite` are the emitters; Task 9's widget invite bubble is the consumer.

- [ ] **Step 1: Write the failing test**

Check `packages/core/src/state/events.test.ts`'s existing shape first (it asserts `CHAT_EVENT_NAMES` matches `ChatEventMap`'s keys exhaustively — read it before editing). Add the two new names to whatever array/assertion it uses to enumerate the full catalog, e.g.:

```ts
  it('CHAT_EVENT_NAMES includes flowInvite and flowInviteCleared', () => {
    expect(CHAT_EVENT_NAMES).toContain('flowInvite');
    expect(CHAT_EVENT_NAMES).toContain('flowInviteCleared');
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @dhaam-ccrm/core test events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the event map entries**

In `packages/core/src/state/events.ts`, add `FlowInvitePayload` to the existing `import type { ... } from '../protocol/index.js';` block, and add two entries to `ChatEventMap` right before the closing `error: ChatError;` line:

```ts
  /**
   * A server-pushed `flow.invite` (chatbot-workflows-commerce.md §6): a flow
   * would like to start and there is no chat yet. The widget's invite bubble
   * is the intended subscriber.
   */
  flowInvite: FlowInvitePayload;

  /**
   * The invite named by `inviteId` is no longer live — accepted via
   * `client.acceptInvite` or declined via `client.dismissInvite`. There is no
   * wire signal for an invite expiring on its own (`FlowInvitePayload` carries
   * no TTL), so this never fires on a timer this SDK invents — only on one of
   * those two calls. The widget's invite bubble subscribes to this rather than
   * polling state, so it can hide the bubble the instant either happens.
   */
  flowInviteCleared: { inviteId: string };

  /** Any protocol- or transport-level error (§7.4). */
  error: ChatError;
```

Add both names to the `CHAT_EVENT_NAMES` array, right before `'error',`:

```ts
  'flowInvite',
  'flowInviteCleared',
  'error',
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @dhaam-ccrm/core test events.test.ts`
Expected: PASS. Also run `pnpm --filter @dhaam-ccrm/core typecheck` — `CHAT_EVENT_NAMES`'s `satisfies readonly ChatEventName[]` check is what actually proves the array and the map didn't drift apart.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/events.ts packages/core/src/state/events.test.ts
git commit -m "feat(core): add flowInvite/flowInviteCleared to the §6.5 event catalog"
```

---

## Task 5 (core): Connection controller invite latch

**Files:**
- Modify: `packages/core/src/connection/controller.ts:314-318` (near `requestNewSession`), `:501-567` (`#openSocket`'s hello build), `:705-756` (`#handleConnectionAck`)
- Test: `packages/core/src/connection/controller.test.ts`

**Interfaces:**
- Consumes: `ConnectionHelloPayload.inviteId` (Task 1, Task 2).
- Produces: `ConnectionController.carryInvite(inviteId: string): void` — Task 6's `client.acceptInvite` is the sole caller.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/connection/controller.test.ts`, reusing the file's existing `harness`/`connected`/`tick` helpers:

```ts
describe('ConnectionController — flow invite latch (chatbot-workflows-commerce.md §6)', () => {
  it('carries inviteId on the next hello after carryInvite()', async () => {
    const h = await connected();
    h.controller.carryInvite('inv_1');
    h.controller.disconnect();
    const reconnecting = h.controller.connect();
    await tick();
    expect(h.transport.lastConnect.hello.inviteId).toBe('inv_1');
    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await reconnecting;
  });

  it('clears the pending inviteId once an ack confirms it, so a LATER reconnect does not resend it', async () => {
    const h = await connected();
    h.controller.carryInvite('inv_1');
    h.controller.disconnect();
    let reconnecting = h.controller.connect();
    await tick();
    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await reconnecting;

    h.controller.disconnect();
    reconnecting = h.controller.connect();
    await tick();
    expect('inviteId' in h.transport.lastConnect.hello).toBe(false);
    h.transport.open();
    h.transport.emitFrame(ackFrame());
    await reconnecting;
  });

  it('a plain hello with no carryInvite() call never carries inviteId', async () => {
    const h = await connected();
    expect('inviteId' in h.transport.lastConnect.hello).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @dhaam-ccrm/core test controller.test.ts`
Expected: FAIL — `h.controller.carryInvite` is not a function.

- [ ] **Step 3: Implement the latch**

In `packages/core/src/connection/controller.ts`, add a new private field near `#pendingNewSessionTopic` (around line 176):

```ts
  /** See {@link carryInvite}. */
  #pendingInviteId: string | undefined;
```

Add the public method right after `requestNewSession` (around line 318):

```ts
  /**
   * Carries `inviteId` on the NEXT `connection.hello` this controller
   * builds — `client.acceptInvite`'s latch (chatbot-workflows-commerce.md
   * §6). Cleared once a `connection.ack` confirms a hello actually carried
   * it, matching the server's "accept once" rule (flow-adapters.ts): a
   * transport retry of the SAME attempt must still carry the same id, but a
   * reconnect that happens AFTER acceptance must not resend it. Does not
   * itself open a socket — the caller sequences the reconnect around it,
   * exactly as `requestNewSession` documents for `newSession`.
   */
  carryInvite(inviteId: string): void {
    this.#pendingInviteId = inviteId;
  }
```

In `#openSocket`'s hello object (around line 545), add one more spread right after the topic line:

```ts
      ...(this.#pendingNewSessionTopic === undefined ? {} : { topic: this.#pendingNewSessionTopic }),
      // Accepts an invite — see `carryInvite`.
      ...(this.#pendingInviteId === undefined ? {} : { inviteId: this.#pendingInviteId }),
```

In `#handleConnectionAck` (around line 734), clear it alongside the other one-shot latches:

```ts
    this.#pendingNewSession = false;
    this.#pendingNewSessionSubject = undefined;
    this.#pendingNewSessionTopic = undefined;
    this.#pendingInviteId = undefined;
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @dhaam-ccrm/core test controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/connection/controller.ts packages/core/src/connection/controller.test.ts
git commit -m "feat(core): ConnectionController.carryInvite — inviteId on the next hello"
```

---

## Task 6 (core): Client methods (`sendVisitorEvent`, `acceptInvite`, `dismissInvite`)

**Files:**
- Modify: `packages/core/src/client/types.ts` (add 3 methods to `ChatClient`)
- Modify: `packages/core/src/client/create-chat-client.ts:33-65` (imports), `:442-512` (`dispatchFrame`'s switch), `:1960-1973` (near `setPageContext`, add 3 new methods)
- Test: `packages/core/src/client/visitor-event.test.ts` (new)
- Test: `packages/core/src/client/flow-invite.test.ts` (new)

**Interfaces:**
- Consumes: `normalizeVisitorEvent` (Task 3), `ChatEventMap.flowInvite`/`.flowInviteCleared` (Task 4), `ConnectionController.carryInvite` (Task 5).
- Produces: `ChatClient.sendVisitorEvent(name: string, props?: Record<string, unknown>): void`, `ChatClient.acceptInvite(inviteId: string): void`, `ChatClient.dismissInvite(inviteId: string): void`. Task 9's widget wraps all three.

- [ ] **Step 1: Write the failing client tests — visitor events**

Create `packages/core/src/client/visitor-event.test.ts`, reusing `page-context.test.ts`'s exact harness shape:

```ts
// client.sendVisitorEvent — chatbot-workflows-commerce.md §4, through
// createChatClient's public surface.

import { describe, expect, it } from 'vitest';

import type { MessageHistorySource, MessagePage } from '../messages/index.js';
import { ManualTimers } from '../presence/index.js';
import type { ConnectionAckPayload, SessionSnapshot } from '../protocol/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { StubSocketFactory } from '../transport/index.js';
import { createChatClient } from './create-chat-client.js';
import type { ChatClientConfig } from './types.js';

async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const CUSTOMER_ID = 'participant_customer_1';

const SESSION: SessionSnapshot = {
  sessionId: 'session_1',
  status: 'OPEN',
  mode: 'BOT',
  participants: [{ participantId: CUSTOMER_ID, type: 'CUSTOMER' }],
  createdAt: '2026-08-18T09:00:00.000Z',
};

function ackJson(): unknown {
  const payload: ConnectionAckPayload = { protocolVersion: 1, session: SESSION, seq: 0 };
  return { v: 1, t: 'connection.ack', id: '01ARZ3NDEKTSV4RRFFQ69G5FAA', ts: 0, d: payload };
}

class EmptyHistory implements MessageHistorySource {
  async listMessages(): Promise<MessagePage> {
    return { messages: [], hasMore: false };
  }
}

function harness(logger = (_level: string, _msg: string, _meta?: Record<string, unknown>) => undefined) {
  const sockets = new StubSocketFactory();
  const timers = new ManualTimers();
  const config: ChatClientConfig = {
    publishableKey: 'dhp' + '_test_visitorevent1',
    getToken: async () => 'tok_ve',
    wsUrl: 'wss://example.test/chat-services/v2/ws',
    storage: new MemoryStorageAdapter(),
    localSender: { senderId: CUSTOMER_ID, senderType: 'CUSTOMER' },
    history: new EmptyHistory(),
    webSocketFactory: sockets.create,
    schedule: timers.schedule,
    now: timers.clock,
    logger: (level, msg, meta) => logger(level, msg, meta),
  };
  const client = createChatClient(config);
  return { client, sockets, timers };
}

type Frame = { t: string; d: Record<string, unknown> };

const framesOf = (h: ReturnType<typeof harness>, type: string): Frame[] =>
  (h.sockets.last.sentFrames() as Frame[]).filter((frame) => frame.t === type);

async function connect(h: ReturnType<typeof harness>): Promise<void> {
  const connecting = h.client.connect();
  await tick();
  h.sockets.last.open();
  h.sockets.last.emitJson(ackJson());
  await connecting;
  await tick();
}

describe('sendVisitorEvent while connected', () => {
  it('sends immediately, with no coalescing delay', async () => {
    const h = harness();
    await connect(h);
    h.client.sendVisitorEvent('exit_intent', {});
    const events = framesOf(h, 'visitor.event');
    expect(events).toHaveLength(1);
    expect(events[0]?.d).toEqual({ name: 'exit_intent', props: {} });
  });

  it('sends two events fired in the same tick as two distinct frames — never coalesced', async () => {
    const h = harness();
    await connect(h);
    h.client.sendVisitorEvent('cart_updated', { items: 1 });
    h.client.sendVisitorEvent('cart_updated', { items: 2 });
    expect(framesOf(h, 'visitor.event')).toHaveLength(2);
  });

  it('drops an unrecognised name with a logger warning, and never throws', async () => {
    const warnings: string[] = [];
    const h = harness((level, msg) => {
      if (level === 'warn') warnings.push(msg);
    });
    await connect(h);
    expect(() => h.client.sendVisitorEvent('made_up_event', {})).not.toThrow();
    expect(framesOf(h, 'visitor.event')).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('drops the whole event when a required prop is missing or invalid', async () => {
    const h = harness();
    await connect(h);
    h.client.sendVisitorEvent('cart_updated', { items: -5, value: 'free' });
    expect(framesOf(h, 'visitor.event')).toHaveLength(0);
  });
});

describe('sendVisitorEvent before the connection exists', () => {
  it('is dropped, not queued, and never throws or blocks connect()', async () => {
    const h = harness();
    expect(() => h.client.sendVisitorEvent('exit_intent', {})).not.toThrow();
    await connect(h);
    expect(framesOf(h, 'visitor.event')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write the failing client tests — flow invite**

Create `packages/core/src/client/flow-invite.test.ts`, reusing the same harness (copy the harness/`connect`/`framesOf` helpers verbatim from `visitor-event.test.ts`, then add):

```ts
describe('a pushed flow.invite', () => {
  it('is delivered as the flowInvite event, payload verbatim', async () => {
    const h = harness();
    const received: unknown[] = [];
    h.client.on('flowInvite', (payload) => received.push(payload));
    await connect(h);
    h.sockets.last.emitJson({
      v: 1,
      t: 'flow.invite',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAB',
      ts: 0,
      d: { inviteId: 'inv_1', text: 'Need a hand?' },
    });
    expect(received).toEqual([{ inviteId: 'inv_1', text: 'Need a hand?' }]);
  });
});

describe('acceptInvite', () => {
  it('reconnects, and the new hello carries inviteId', async () => {
    const h = harness();
    await connect(h);
    h.client.acceptInvite('inv_1');
    await tick();
    h.sockets.last.open();
    h.sockets.last.emitJson(ackJson());
    await tick();
    const [hello] = framesOf(h, 'connection.hello');
    expect(hello?.d['inviteId']).toBe('inv_1');
  });

  it('emits flowInviteCleared synchronously, before the reconnect settles', async () => {
    const h = harness();
    await connect(h);
    const cleared: unknown[] = [];
    h.client.on('flowInviteCleared', (payload) => cleared.push(payload));
    h.client.acceptInvite('inv_1');
    expect(cleared).toEqual([{ inviteId: 'inv_1' }]);
  });

  it('ignores a non-string/empty id and never throws', async () => {
    const h = harness();
    await connect(h);
    expect(() => h.client.acceptInvite('')).not.toThrow();
    expect(() => h.client.acceptInvite(undefined as never)).not.toThrow();
  });
});

describe('dismissInvite', () => {
  it('sends flow.inviteDismissed immediately and emits flowInviteCleared', async () => {
    const h = harness();
    await connect(h);
    const cleared: unknown[] = [];
    h.client.on('flowInviteCleared', (payload) => cleared.push(payload));
    h.client.dismissInvite('inv_1');
    expect(framesOf(h, 'flow.inviteDismissed')).toEqual([
      expect.objectContaining({ d: { inviteId: 'inv_1' } }),
    ]);
    expect(cleared).toEqual([{ inviteId: 'inv_1' }]);
  });

  it('never throws on a bad id', async () => {
    const h = harness();
    await connect(h);
    expect(() => h.client.dismissInvite('')).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm --filter @dhaam-ccrm/core test visitor-event.test.ts flow-invite.test.ts`
Expected: FAIL — `sendVisitorEvent`/`acceptInvite`/`dismissInvite` don't exist on `ChatClient` yet.

- [ ] **Step 4: Add the methods to `ChatClient`**

In `packages/core/src/client/types.ts`, add after `setPageContext(context: unknown): void;` (around line 715):

```ts
  /**
   * Reports a visitor fact the server's flow engine can trigger on
   * (chatbot-workflows-commerce.md §4) — `search`, `cart_updated`,
   * `exit_intent`, `product_viewed`. Not a message: never stored, never in
   * the transcript. Validates locally and drops an unrecognised name or
   * invalid props with a logger warning — same "never throws" contract as
   * `setPageContext` — and, unlike page context, sends immediately: each
   * event is a distinct fact rather than a single current value, so there is
   * nothing to coalesce.
   */
  sendVisitorEvent(name: string, props?: Record<string, unknown>): void;

  /**
   * Accepts a server-pushed `flow.invite` (chatbot-workflows-commerce.md
   * §6): carries `inviteId` on the next `connection.hello` and reconnects to
   * send it. Never throws — a bad id is dropped with a logger warning.
   */
  acceptInvite(inviteId: string): void;

  /**
   * Declines a server-pushed `flow.invite`: sends `flow.inviteDismissed`
   * immediately. Never throws.
   */
  dismissInvite(inviteId: string): void;
```

- [ ] **Step 5: Implement them in `create-chat-client.ts`**

Edit the import block (around line 45-46) to pull in the normalizer:

```ts
import { PageContextSync } from './page-context-sync.js';
import { isParkedCloseReason, normalizeVisitorEvent } from '../protocol/index.js';
```

Add a `case 'flow.invite':` to `dispatchFrame`'s switch (around line 505-509), right after the `'ticket.linked'` case:

```ts
      case 'ticket.linked':
        store.setState({ session: applyTicketLinked(store.getState().session, frame.d) });
        store.emit('ticketLinked', frame.d);
        return;
      case 'flow.invite':
        store.emit('flowInvite', frame.d);
        return;
      case 'system.pong':
        return;
```

Add the three methods to the returned `ChatClient` object, right after `setPageContext` (around line 1973):

```ts
    setPageContext: (context) => {
      try {
        if (!pageSync.set(context)) {
          config.logger?.('warn', 'setPageContext ignored a value that is not an object');
        }
      } catch (error) {
        config.logger?.('warn', 'setPageContext failed', { error: String(error) });
      }
    },
    // Never throws — a bad event is advisory, same contract as setPageContext.
    sendVisitorEvent: (name, props) => {
      try {
        const event = normalizeVisitorEvent(name, props);
        if (event === null) {
          config.logger?.('warn', 'sendVisitorEvent ignored an unrecognised name or invalid props');
          return;
        }
        realTransport.send('visitor.event', event);
      } catch (error) {
        config.logger?.('warn', 'sendVisitorEvent failed', { error: String(error) });
      }
    },
    acceptInvite: (inviteId) => {
      try {
        if (typeof inviteId !== 'string' || inviteId === '') {
          config.logger?.('warn', 'acceptInvite ignored a value that is not a non-empty string');
          return;
        }
        // Optimistic and synchronous: the widget's bubble hides the instant
        // the visitor taps accept, not once the reconnect round-trips.
        store.emit('flowInviteCleared', { inviteId });
        connectionController.carryInvite(inviteId);
        connectionController.disconnect();
        void connectionController.connect();
      } catch (error) {
        config.logger?.('warn', 'acceptInvite failed', { error: String(error) });
      }
    },
    dismissInvite: (inviteId) => {
      try {
        if (typeof inviteId !== 'string' || inviteId === '') {
          config.logger?.('warn', 'dismissInvite ignored a value that is not a non-empty string');
          return;
        }
        store.emit('flowInviteCleared', { inviteId });
        realTransport.send('flow.inviteDismissed', { inviteId });
      } catch (error) {
        config.logger?.('warn', 'dismissInvite failed', { error: String(error) });
      }
    },
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `pnpm --filter @dhaam-ccrm/core test visitor-event.test.ts flow-invite.test.ts`
Expected: PASS. Then run the full core suite: `pnpm --filter @dhaam-ccrm/core test` — this task touches `dispatchFrame`'s switch and `ChatClient`, both widely depended-on.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/client/types.ts packages/core/src/client/create-chat-client.ts packages/core/src/client/visitor-event.test.ts packages/core/src/client/flow-invite.test.ts
git commit -m "feat(core): client.sendVisitorEvent/acceptInvite/dismissInvite"
```

---

## Task 7 (widget): Invite bubble UI component

**Files:**
- Create: `packages/widget/src/ui/invite-bubble.ts`
- Test: `packages/widget/test/invite-bubble.test.ts`

**Interfaces:**
- Consumes: `el` (`packages/widget/src/ui/dom.ts`).
- Produces: `createInviteBubble(callbacks: { onAccept(inviteId: string): void; onDismiss(inviteId: string): void }): InviteBubbleElement`, `InviteView { inviteId: string; text: string; buttons: readonly {id:string;label:string}[] }`. Task 9 mounts this and drives it from `flowInvite`/`flowInviteCleared`.

- [ ] **Step 1: Write the failing test**

Create `packages/widget/test/invite-bubble.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createInviteBubble } from '../src/ui/invite-bubble.js';

function build() {
  const onAccept = vi.fn();
  const onDismiss = vi.fn();
  const bubble = createInviteBubble({ onAccept, onDismiss });
  document.body.appendChild(bubble.node);
  return { bubble, onAccept, onDismiss };
}

describe('the invite bubble', () => {
  it('is hidden until update() is called', () => {
    const { bubble } = build();
    expect(bubble.node.hidden).toBe(true);
  });

  it('shows the invite text and un-hides', () => {
    const { bubble } = build();
    bubble.update({ inviteId: 'inv_1', text: 'Need a hand finding something?', buttons: [] });
    expect(bubble.node.hidden).toBe(false);
    expect(bubble.node.textContent).toContain('Need a hand finding something?');
  });

  it('hides again on update(null)', () => {
    const { bubble } = build();
    bubble.update({ inviteId: 'inv_1', text: 'hi', buttons: [] });
    bubble.update(null);
    expect(bubble.node.hidden).toBe(true);
  });

  it('tapping the text accepts the invite', () => {
    const { bubble, onAccept } = build();
    bubble.update({ inviteId: 'inv_1', text: 'hi', buttons: [] });
    bubble.node.querySelector<HTMLElement>('.dh-invite-text')?.click();
    expect(onAccept).toHaveBeenCalledWith('inv_1');
  });

  it('renders a button per entry and tapping one also accepts', () => {
    const { bubble, onAccept } = build();
    bubble.update({
      inviteId: 'inv_1',
      text: 'Looking for something?',
      buttons: [{ id: 'b1', label: 'Yes please' }],
    });
    const buttons = bubble.node.querySelectorAll<HTMLElement>('.dh-invite-button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('Yes please');
    buttons[0]?.click();
    expect(onAccept).toHaveBeenCalledWith('inv_1');
  });

  it('the close affordance dismisses without accepting', () => {
    const { bubble, onAccept, onDismiss } = build();
    bubble.update({ inviteId: 'inv_1', text: 'hi', buttons: [] });
    bubble.node.querySelector<HTMLElement>('.dh-invite-close')?.click();
    expect(onDismiss).toHaveBeenCalledWith('inv_1');
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('never puts markup in the DOM — text only', () => {
    const { bubble } = build();
    bubble.update({ inviteId: 'inv_1', text: '<img src=x onerror=alert(1)>', buttons: [] });
    expect(bubble.node.querySelector('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @dhaam-ccrm/widget test invite-bubble.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

Create `packages/widget/src/ui/invite-bubble.ts`:

```ts
// The bubble shown when the server pushes a `flow.invite`
// (chatbot-workflows-commerce.md §6): a flow would like to start and there
// is no chat yet. Anchored beside the launcher rather than inside the panel
// — the panel may well be closed, which is the whole point of an invite.
//
// Text only, like every other string this widget renders (ui/dom.ts's `el`
// header) — an invite's text and button labels are merchant-authored flow
// copy, but still untrusted shape-wise by the time it reaches here.

import { el } from './dom.js';

export interface InviteBubbleButton {
  readonly id: string;
  readonly label: string;
}

export interface InviteView {
  readonly inviteId: string;
  readonly text: string;
  readonly buttons: readonly InviteBubbleButton[];
}

export interface InviteBubbleElement {
  readonly node: HTMLElement;
  /** Shows `view`, or hides the bubble when `view` is `null`. */
  update(view: InviteView | null): void;
}

/**
 * Builds the bubble. Hidden until {@link InviteBubbleElement.update} shows
 * one — a widget that has never received an invite must never flash one.
 */
export function createInviteBubble(callbacks: {
  /** Tapping the bubble's text, or any of its buttons: accept this invite. */
  readonly onAccept: (inviteId: string) => void;
  /** The bubble's own close affordance. */
  readonly onDismiss: (inviteId: string) => void;
}): InviteBubbleElement {
  let current: InviteView | null = null;

  const text = el('button', {
    attrs: { class: 'dh-invite-text', type: 'button' },
    on: {
      click: () => {
        if (current !== null) callbacks.onAccept(current.inviteId);
      },
    },
  });
  const actions = el('div', { attrs: { class: 'dh-invite-actions' } });
  const close = el('button', {
    attrs: { class: 'dh-invite-close', type: 'button', 'aria-label': 'Dismiss' },
    text: '×',
    on: {
      click: () => {
        if (current !== null) callbacks.onDismiss(current.inviteId);
      },
    },
  });

  const node = el('div', {
    attrs: { class: 'dh-invite-bubble', hidden: true, role: 'dialog', 'aria-live': 'polite' },
    children: [close, text, actions],
  });

  return {
    node,
    update(view) {
      if (view === null) {
        current = null;
        node.hidden = true;
        return;
      }
      current = view;
      if (text.textContent !== view.text) text.textContent = view.text;

      actions.replaceChildren(
        ...view.buttons.map((button) =>
          el('button', {
            attrs: { class: 'dh-invite-button', type: 'button' },
            text: button.label,
            on: { click: () => callbacks.onAccept(view.inviteId) },
          }),
        ),
      );

      node.hidden = false;
    },
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @dhaam-ccrm/widget test invite-bubble.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/ui/invite-bubble.ts packages/widget/test/invite-bubble.test.ts
git commit -m "feat(widget): invite bubble UI component"
```

---

## Task 8 (widget): Exit-intent visitor event wiring

**Files:**
- Modify: `packages/widget/src/widget.ts:1159-1166` (`armAutoOpen`'s `onMouseOut`)
- Test: `packages/widget/test/widget-dom.test.ts` (extend the existing exit-intent `describe` block)

**Interfaces:**
- Consumes: `store.client.sendVisitorEvent` (core Task 6), already reachable — `store` is already in scope at this point in `widget.ts` (the same object `setPage` closes over).
- Produces: nothing new — behavioural change only.

- [ ] **Step 1: Write the failing tests**

Add to `packages/widget/test/widget-dom.test.ts`, first adding `getWidget` to the existing import (`import { createWidget, getWidget, mount, unmount } from '../src/index.js';`), then adding two `it()`s to the existing `describe('opening itself', ...)` block, right after the `'releases the exit-intent listener on destroy'` test:

```ts
  it('fires exit_intent exactly once alongside the existing auto-open', async () => {
    await publish({ autoOpen: 'exit-intent' });
    const widget = getWidget();
    if (widget === null) throw new Error('widget not mounted');
    const spy = vi.spyOn(widget.store.client, 'sendVisitorEvent');
    document.dispatchEvent(
      new MouseEvent('mouseout', { relatedTarget: null, clientY: 0, bubbles: true }),
    );
    expect(isOpen()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('exit_intent', {});
  });

  it('does not fire the event for a mouseout that stays inside the document', async () => {
    await publish({ autoOpen: 'exit-intent' });
    const widget = getWidget();
    if (widget === null) throw new Error('widget not mounted');
    const spy = vi.spyOn(widget.store.client, 'sendVisitorEvent');
    document.dispatchEvent(
      new MouseEvent('mouseout', { relatedTarget: document.body, clientY: 0, bubbles: true }),
    );
    expect(spy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @dhaam-ccrm/widget test widget-dom.test.ts`
Expected: FAIL — `sendVisitorEvent` is never called yet.

- [ ] **Step 3: Wire the event into the existing detector**

In `packages/widget/src/widget.ts`, edit `onMouseOut` (around line 1159-1164):

```ts
    const onMouseOut = (event: MouseEvent): void => {
      // `relatedTarget === null` means the pointer left the document itself
      // rather than moving between two elements inside it.
      if (event.relatedTarget !== null || event.clientY > 0) return;
      // One detector, two effects (chatbot-workflows-commerce.md §4): the
      // existing UI auto-open, and the fact the server's flow engine can
      // trigger "About to leave with a cart" on. Never a second listener.
      store.client.sendVisitorEvent('exit_intent', {});
      fire();
    };
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @dhaam-ccrm/widget test widget-dom.test.ts`
Expected: PASS — including every pre-existing test in that file (this is a shared detector; confirm nothing else regressed).

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/widget.ts packages/widget/test/widget-dom.test.ts
git commit -m "feat(widget): exit-intent mouseout also fires visitor.event exit_intent"
```

---

## Task 9 (widget): `ChatWidget.sendEvent`/`.dismissInvite` and invite bubble mounting

**Files:**
- Modify: `packages/widget/src/widget.ts:135-152` (`ChatWidget` interface), `:692-2768` area (`createWidget` body: bubble construction, subscriptions, `shadow.append`, the returned object at `:5406-5423`)
- Test: `packages/widget/test/invite-bubble-mount.test.ts` (new)

**Interfaces:**
- Consumes: `createInviteBubble` (Task 7), `store.client.sendVisitorEvent`/`.acceptInvite`/`.dismissInvite` (core Task 6), `store.on('flowInvite'|'flowInviteCleared', ...)` (core Task 4).
- Produces: `ChatWidget.sendEvent(name: string, props?: Record<string, unknown>): void`, `ChatWidget.dismissInvite(): void` (dismisses whichever invite is currently shown; no-op if none). Task 10's `embed.ts` wraps both.

- [ ] **Step 1: Write the failing test**

Create `packages/widget/test/invite-bubble-mount.test.ts`:

```ts
// @vitest-environment jsdom
//
// The invite bubble end to end: appears on a pushed flow.invite, autoOpen
// opens the panel directly instead, accepting reconnects with inviteId on
// the hello, and dismissing (by the bubble's own close button, or
// widget.dismissInvite()) sends flow.inviteDismissed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, unmount } from '../src/index.js';
import type { WidgetConfig } from '../src/config.js';

const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let ulidCounter = 0;
function ulid(): string {
  const c = ULID_ALPHABET[ulidCounter++ % 32] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${c}${c}`;
}

class AckingSocket {
  static instances: AckingSocket[] = [];
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(readonly url: string) {
    AckingSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
  open(): void {
    this.onopen?.();
  }
  push(t: string, d: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, t, id: ulid(), ts: Date.now(), d }) });
  }
  ack(sessionId: string): void {
    this.push('connection.ack', {
      protocolVersion: 1,
      seq: 0,
      session: {
        sessionId,
        status: 'ASSIGNED',
        mode: 'HUMAN',
        participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
        createdAt: new Date().toISOString(),
      },
    });
  }
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    auth: { publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function shadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element?.shadowRoot == null) throw new Error('widget not mounted');
  return element.shadowRoot;
}

const find = <T extends Element>(selector: string): T | null => shadow().querySelector<T>(selector);
const isOpen = (): boolean => find<HTMLElement>('.dh-panel')?.getAttribute('data-open') === 'true';

type Frame = { t: string; d: Record<string, unknown> };
const frames = (type: string): Frame[] =>
  AckingSocket.instances.flatMap((s) => s.sent.map((raw) => JSON.parse(raw) as Frame)).filter((f) => f.t === type);

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  AckingSocket.instances = [];
  vi.stubGlobal('WebSocket', AckingSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

async function mountAndConnect(overrides: Partial<WidgetConfig> = {}) {
  const widget = mount(config(overrides));
  await settle();
  AckingSocket.instances[0]!.ack('sess_1');
  await settle();
  return widget;
}

describe('a pushed flow.invite', () => {
  it('shows the bubble with the pushed text', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'Need a hand?' });
    await settle();
    const bubble = find<HTMLElement>('.dh-invite-bubble');
    expect(bubble?.hidden).toBe(false);
    expect(bubble?.textContent).toContain('Need a hand?');
  });

  it('autoOpen skips the bubble and opens the panel directly', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi', autoOpen: true });
    await settle();
    expect(isOpen()).toBe(true);
    expect(find<HTMLElement>('.dh-invite-bubble')?.hidden).toBe(true);
  });

  it('accepting reconnects with inviteId on the hello and hides the bubble', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    find<HTMLElement>('.dh-invite-text')?.click();
    await settle();
    expect(find<HTMLElement>('.dh-invite-bubble')?.hidden).toBe(true);
    const hellos = frames('connection.hello');
    expect(hellos[hellos.length - 1]?.d['inviteId']).toBe('inv_1');
  });

  it('dismissing via the bubble sends flow.inviteDismissed and hides it', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    find<HTMLElement>('.dh-invite-close')?.click();
    await settle();
    expect(frames('flow.inviteDismissed')).toEqual([{ t: 'flow.inviteDismissed', d: { inviteId: 'inv_1' } }]);
    expect(find<HTMLElement>('.dh-invite-bubble')?.hidden).toBe(true);
  });

  it('widget.dismissInvite() dismisses whichever invite is currently shown', async () => {
    const widget = await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    widget.dismissInvite();
    await settle();
    expect(frames('flow.inviteDismissed')).toEqual([{ t: 'flow.inviteDismissed', d: { inviteId: 'inv_1' } }]);
  });

  it('widget.dismissInvite() is a harmless no-op with nothing showing', async () => {
    const widget = await mountAndConnect();
    expect(() => widget.dismissInvite()).not.toThrow();
    expect(frames('flow.inviteDismissed')).toEqual([]);
  });

  it('a widget destroyed while an invite is showing does not throw on a later frame', async () => {
    await mountAndConnect();
    AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_1', text: 'hi' });
    await settle();
    unmount();
    expect(() => AckingSocket.instances[0]!.push('flow.invite', { inviteId: 'inv_2', text: 'hi' })).not.toThrow();
  });
});

describe('widget.sendEvent', () => {
  it('sends a visitor.event frame', async () => {
    const widget = await mountAndConnect();
    widget.sendEvent('search', { query: 'shoes', results: 4 });
    await settle();
    expect(frames('visitor.event')).toEqual([
      { t: 'visitor.event', d: { name: 'search', props: { query: 'shoes', results: 4 } } },
    ]);
  });

  it('never throws on a bad call', async () => {
    const widget = await mountAndConnect();
    expect(() => widget.sendEvent('not_a_real_event')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @dhaam-ccrm/widget test invite-bubble-mount.test.ts`
Expected: FAIL — `sendEvent`/`dismissInvite` are not on `ChatWidget` yet, and no `.dh-invite-bubble` exists in the DOM.

- [ ] **Step 3: Extend the `ChatWidget` interface**

In `packages/widget/src/widget.ts`, edit the interface (around line 135-152):

```ts
export interface ChatWidget {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  setPage(page: PageContext): void;
  /**
   * Reports a visitor fact the server's flow engine can trigger on
   * (chatbot-workflows-commerce.md §4) — `search`, `cart_updated`,
   * `exit_intent`, `product_viewed`. Never throws; a bad call is dropped
   * with a warning to `config.onError`.
   */
  sendEvent(name: string, props?: Record<string, unknown>): void;
  /**
   * Dismisses whichever `flow.invite` the widget is currently showing a
   * bubble for. A harmless no-op when nothing is showing.
   */
  dismissInvite(): void;
  readonly store: ChatStore;
  destroy(): void;
}
```

- [ ] **Step 4: Wire it up inside `createWidget`**

In `packages/widget/src/widget.ts`, import `createInviteBubble` and its types near the other `ui/` imports (alongside the `createOfflineBanner` import):

```ts
import { createInviteBubble } from './ui/invite-bubble.js';
```

Right after the `setPage` definition (around line 702-709), add:

```ts
  const sendEvent = (name: string, props?: Record<string, unknown>): void => {
    try {
      store.client.sendVisitorEvent(name, props);
    } catch (error) {
      config.onError(error);
    }
  };

  /** Whichever invite the bubble is currently showing, or `null`. */
  let currentInviteId: string | null = null;

  const acceptInvite = (inviteId: string): void => {
    store.client.acceptInvite(inviteId);
    openPanel();
  };
  const dismissInvite = (inviteId: string): void => {
    store.client.dismissInvite(inviteId);
  };
  const inviteBubble = createInviteBubble({ onAccept: acceptInvite, onDismiss: dismissInvite });
```

Add the append target: find `shadow.append(launcher, panel);` (around line 2768) and change it to:

```ts
  shadow.append(launcher, panel, inviteBubble.node);
```

Add two entries to the `unsubscribers` array (around line 2915, anywhere in the list — e.g. right after the `sessionClosed` subscription):

```ts
    store.on('flowInvite', (payload) => {
      currentInviteId = payload.inviteId;
      if (payload.autoOpen === true) {
        store.client.acceptInvite(payload.inviteId);
        openPanel();
        return;
      }
      inviteBubble.update({ inviteId: payload.inviteId, text: payload.text, buttons: payload.buttons ?? [] });
    }),
    store.on('flowInviteCleared', ({ inviteId }) => {
      if (currentInviteId !== inviteId) return;
      currentInviteId = null;
      inviteBubble.update(null);
    }),
```

Add both methods to the returned object (around line 5406-5423), right after `setPage`:

```ts
  return {
    store,
    open: openPanel,
    close,
    toggle,
    isOpen: () => open,
    setPage: (page) => setPage(page),
    sendEvent: (name, props) => sendEvent(name, props),
    dismissInvite: () => {
      if (currentInviteId !== null) dismissInvite(currentInviteId);
    },
    destroy() {
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --filter @dhaam-ccrm/widget test invite-bubble-mount.test.ts`
Expected: PASS. Then run the full widget suite: `pnpm --filter @dhaam-ccrm/widget test` — this task edits the shared `shadow.append` line and the `unsubscribers` array, both load-bearing for every other widget test.

- [ ] **Step 6: Commit**

```bash
git add packages/widget/src/widget.ts packages/widget/test/invite-bubble-mount.test.ts
git commit -m "feat(widget): sendEvent/dismissInvite API, mount and wire the invite bubble"
```

---

## Task 10 (widget): `DhaamChatGlobal.sendEvent`/`.dismissInvite`

**Files:**
- Modify: `packages/widget/src/embed.ts:33-72` (`DhaamChatGlobal` interface), `:181-231` (`install()`'s `api` object)
- Test: `packages/widget/test/embed-send-event.test.ts` (new)

**Interfaces:**
- Consumes: `ChatWidget.sendEvent`/`.dismissInvite` (Task 9), `getWidget` (`packages/widget/src/index.ts`, already exported).
- Produces: `window.DhaamChat.sendEvent(name, props)`, `window.DhaamChat.dismissInvite()`.

- [ ] **Step 1: Write the failing test**

Create `packages/widget/test/embed-send-event.test.ts`, reusing `embed-set-page.test.ts`'s exact harness (`FakeWebSocket`, `config`, `settle`, `loadEmbed`, `connect`):

```ts
// @vitest-environment jsdom
//
// `DhaamChat.sendEvent`/`.dismissInvite` — the script-tag form.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWidget, mount, unmount } from '../src/index.js';
import type { DhaamChatGlobal } from '../src/embed.js';
import type { WidgetConfig } from '../src/config.js';

const PK_TEST = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let ulidCounter = 0;
function ulid(): string {
  const c = ULID_ALPHABET[ulidCounter++ % 32] ?? '0';
  return `01ARZ3NDEKTSV4RRFFQ69G5F${c}${c}`;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
  open(): void {
    this.onopen?.();
  }
  ack(sessionId: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'connection.ack',
        id: ulid(),
        ts: Date.now(),
        d: {
          protocolVersion: 1,
          seq: 0,
          session: {
            sessionId,
            status: 'ASSIGNED',
            mode: 'HUMAN',
            participants: [{ participantId: 'cus_1', type: 'CUSTOMER' }],
            createdAt: new Date().toISOString(),
          },
        },
      }),
    });
  }
}

function config(): WidgetConfig {
  return {
    auth: { publishableKey: PK_TEST, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: 'https://chat.example.com',
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadEmbed(): Promise<DhaamChatGlobal> {
  vi.resetModules();
  await import('../src/embed.js');
  const api = (window as unknown as Record<string, unknown>)['DhaamChat'];
  if (api === undefined) throw new Error('DhaamChat was not installed');
  return api as DhaamChatGlobal;
}

async function connect(): Promise<FakeWebSocket> {
  await settle();
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.ack('sess_1');
  await settle();
  return socket;
}

beforeEach(() => {
  localStorage.clear();
  ulidCounter = 0;
  FakeWebSocket.instances = [];
  delete (window as unknown as Record<string, unknown>)['DhaamChat'];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  );
  document.body.innerHTML = '';
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

type Frame = { t: string; d: Record<string, unknown> };
const sentFrames = (type: string): Frame[] =>
  FakeWebSocket.instances.flatMap((s) => s.sent.map((raw) => JSON.parse(raw) as Frame)).filter((f) => f.t === type);

describe('DhaamChat.sendEvent', () => {
  it('is installed on the global and forwards to the mounted widget', async () => {
    const api = await loadEmbed();
    expect(typeof api.sendEvent).toBe('function');
    api.mount(config());
    await connect();
    api.sendEvent('exit_intent', {});
    await settle();
    expect(sentFrames('visitor.event')).toEqual([{ t: 'visitor.event', d: { name: 'exit_intent', props: {} } }]);
  });

  it('is a harmless no-op with nothing mounted', async () => {
    const api = await loadEmbed();
    expect(() => api.sendEvent('exit_intent', {})).not.toThrow();
  });
});

describe('DhaamChat.dismissInvite', () => {
  it('is a harmless no-op with nothing mounted', async () => {
    const api = await loadEmbed();
    expect(() => api.dismissInvite()).not.toThrow();
  });

  it('forwards to the mounted widget', async () => {
    const api = await loadEmbed();
    api.mount(config());
    const socket = await connect();
    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: 'flow.invite',
        id: ulid(),
        ts: Date.now(),
        d: { inviteId: 'inv_1', text: 'hi' },
      }),
    });
    await settle();
    api.dismissInvite();
    await settle();
    expect(sentFrames('flow.inviteDismissed')).toEqual([{ t: 'flow.inviteDismissed', d: { inviteId: 'inv_1' } }]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @dhaam-ccrm/widget test embed-send-event.test.ts`
Expected: FAIL — `api.sendEvent`/`api.dismissInvite` are undefined.

- [ ] **Step 3: Extend `DhaamChatGlobal` and `install()`**

In `packages/widget/src/embed.ts`, edit the interface (around line 33-72), adding after `setPage`:

```ts
  /**
   * Reports a visitor fact the server's flow engine can trigger on — the
   * script-tag form of `widget.sendEvent`. A no-op with nothing mounted,
   * same as `open`/`close`/`toggle`: an event fired before the widget
   * exists has no connection to carry it on, so there is nothing to buffer
   * the way `setPage` buffers a pending page.
   */
  sendEvent(name: string, props?: Record<string, unknown>): void;

  /** The script-tag form of `widget.dismissInvite`. A no-op with nothing mounted. */
  dismissInvite(): void;
```

Edit `install()`'s `api` object (around line 182-223), adding after `setPage: (...) => {...},`:

```ts
    sendEvent: (name, props) => getWidget()?.sendEvent(name, props),
    dismissInvite: () => getWidget()?.dismissInvite(),
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @dhaam-ccrm/widget test embed-send-event.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/embed.ts packages/widget/test/embed-send-event.test.ts
git commit -m "feat(widget): DhaamChat.sendEvent/dismissInvite on the script-tag API"
```

---

## Task 11 (widget): Flow card reader + renderer

**Files:**
- Create: `packages/widget/src/ui/flow-cards.ts`
- Test: `packages/widget/test/flow-cards.test.ts`

**Interfaces:**
- Consumes: `el` (`ui/dom.ts`).
- Produces: `readFlowCard(metadata: unknown): FlowCard | null`, `renderFlowCard(card: FlowCard): HTMLElement`, `FlowCard = DiscountCard | ProductsCard | OrderCard`. Task 12's `message-list.ts` is the sole caller.

Field shapes are copied from `chat-service-node/src/application/flows/interpreter.ts`'s `Product`/`OrderSummary` and `flow-messages.ts`'s `botMessage` (`metadata.discount = {code,label,terms}`, `metadata.products = Product[]`, `metadata.order = OrderSummary`).

- [ ] **Step 1: Write the failing test**

Create `packages/widget/test/flow-cards.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { readFlowCard, renderFlowCard } from '../src/ui/flow-cards.js';

describe('readFlowCard — discount', () => {
  it('reads a well-formed discount', () => {
    expect(readFlowCard({ discount: { code: 'SAVE10', label: '10% off', terms: 'Ends Friday' } })).toEqual({
      kind: 'discount',
      code: 'SAVE10',
      label: '10% off',
      terms: 'Ends Friday',
    });
  });

  it('drops the card entirely when code is missing or blank', () => {
    expect(readFlowCard({ discount: { label: '10% off' } })).toBeNull();
    expect(readFlowCard({ discount: { code: '   ' } })).toBeNull();
  });

  it('keeps the code alone when label/terms are absent', () => {
    expect(readFlowCard({ discount: { code: 'SAVE10' } })).toEqual({
      kind: 'discount',
      code: 'SAVE10',
      label: undefined,
      terms: undefined,
    });
  });
});

describe('readFlowCard — products', () => {
  it('reads up to 3 products, dropping the rest', () => {
    const products = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      name: `Product ${i}`,
      price: 10 + i,
      currency: 'INR',
    }));
    const card = readFlowCard({ products });
    expect(card?.kind).toBe('products');
    expect(card?.kind === 'products' && card.items).toHaveLength(3);
  });

  it('skips an entry missing id or name, keeping the rest', () => {
    const card = readFlowCard({
      products: [{ id: 'p1' }, { id: 'p2', name: 'Good one' }, { name: 'no id' }],
    });
    expect(card).toEqual({ kind: 'products', items: [{ id: 'p2', name: 'Good one', price: undefined, currency: undefined, imageUrl: undefined, url: undefined }] });
  });

  it('is null when nothing in the array is usable', () => {
    expect(readFlowCard({ products: [{ id: 'p1' }, {}] })).toBeNull();
  });

  it('is null when products is not an array', () => {
    expect(readFlowCard({ products: 'nope' })).toBeNull();
  });
});

describe('readFlowCard — order', () => {
  it('reads a well-formed order', () => {
    expect(readFlowCard({ order: { number: 'ORD-1', statusLabel: 'On the way', eta: '10 min' } })).toEqual({
      kind: 'order',
      number: 'ORD-1',
      statusLabel: 'On the way',
      eta: '10 min',
      trackingUrl: undefined,
    });
  });

  it('drops the card entirely when number or statusLabel is missing', () => {
    expect(readFlowCard({ order: { statusLabel: 'On the way' } })).toBeNull();
    expect(readFlowCard({ order: { number: 'ORD-1' } })).toBeNull();
  });
});

describe('readFlowCard — malformed input never throws', () => {
  it('is null for null/undefined/non-object metadata', () => {
    expect(readFlowCard(null)).toBeNull();
    expect(readFlowCard(undefined)).toBeNull();
    expect(readFlowCard('a string')).toBeNull();
  });

  it('is null when metadata has none of the three keys', () => {
    expect(readFlowCard({ flow: { runId: 'r1' } })).toBeNull();
  });
});

describe('renderFlowCard', () => {
  it('renders the discount code as text and a copy button', () => {
    const node = renderFlowCard({ kind: 'discount', code: 'SAVE10', label: '10% off', terms: undefined });
    expect(node.querySelector('.dh-discount-code')?.textContent).toBe('SAVE10');
    expect(node.querySelector('.dh-discount-copy')?.textContent).toBe('Copy code');
  });

  it('copy falls back to selecting the code text when navigator.clipboard is unavailable', () => {
    const node = renderFlowCard({ kind: 'discount', code: 'SAVE10', label: undefined, terms: undefined });
    document.body.appendChild(node);
    const button = node.querySelector<HTMLButtonElement>('.dh-discount-copy')!;
    expect(() => button.click()).not.toThrow();
  });

  it('renders at most the products it was given, name and price as text', () => {
    const node = renderFlowCard({
      kind: 'products',
      items: [{ id: 'p1', name: 'Cap', price: 199, currency: 'INR', imageUrl: undefined, url: undefined }],
    });
    expect(node.querySelectorAll('.dh-product-item')).toHaveLength(1);
    expect(node.querySelector('.dh-product-name')?.textContent).toBe('Cap');
    expect(node.querySelector('.dh-product-price')?.textContent).toBe('INR 199');
  });

  it('renders the order number, status, and eta when present', () => {
    const node = renderFlowCard({ kind: 'order', number: 'ORD-1', statusLabel: 'Out for delivery', eta: '10 min', trackingUrl: undefined });
    expect(node.textContent).toContain('ORD-1');
    expect(node.textContent).toContain('Out for delivery');
    expect(node.textContent).toContain('10 min');
  });

  it('never renders markup — an attacker-supplied name stays text', () => {
    const node = renderFlowCard({
      kind: 'products',
      items: [{ id: 'p1', name: '<img src=x onerror=alert(1)>', price: undefined, currency: undefined, imageUrl: undefined, url: undefined }],
    });
    expect(node.querySelector('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @dhaam-ccrm/widget test flow-cards.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/widget/src/ui/flow-cards.ts`:

```ts
// The commerce cards a flow step can send inside a bot message's own
// metadata (chatbot-workflows-commerce.md §8; chat-service-node's
// application/flows/flow-messages.ts's `botMessage` and interpreter.ts's
// `Product`/`OrderSummary`): a discount code, a short list of products, or
// an order's status. Read-only display — no add-to-cart action, no button
// wiring here (`onAction` is Part 3).
//
// Same defensive posture as quick-replies.ts's `readQuickReplies` and
// message-list.ts's `readReplyQuote`: this metadata arrives from a flow
// step two services away, so a missing or malformed field renders nothing
// for that field rather than throwing, and a bag with nothing usable in it
// renders no card at all.

import { el } from './dom.js';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface DiscountCard {
  readonly kind: 'discount';
  readonly code: string;
  readonly label: string | undefined;
  readonly terms: string | undefined;
}

export interface ProductCardItem {
  readonly id: string;
  readonly name: string;
  readonly price: number | undefined;
  readonly currency: string | undefined;
  readonly imageUrl: string | undefined;
  readonly url: string | undefined;
}

export interface ProductsCard {
  readonly kind: 'products';
  readonly items: readonly ProductCardItem[];
}

export interface OrderCard {
  readonly kind: 'order';
  readonly number: string;
  readonly statusLabel: string;
  readonly eta: string | undefined;
  readonly trackingUrl: string | undefined;
}

export type FlowCard = DiscountCard | ProductsCard | OrderCard;

/** A chat bubble is not a storefront — more than this reads as a catalogue page, not a suggestion. */
const MAX_PRODUCTS = 3;

function readDiscount(bag: Record<string, unknown>): DiscountCard | null {
  const d = record(bag['discount']);
  if (d === null) return null;
  const code = str(d['code']);
  if (code === undefined) return null;
  return { kind: 'discount', code, label: str(d['label']), terms: str(d['terms']) };
}

function readProducts(bag: Record<string, unknown>): ProductsCard | null {
  const raw = bag['products'];
  if (!Array.isArray(raw)) return null;

  const items: ProductCardItem[] = [];
  for (const entry of raw) {
    const p = record(entry);
    const id = str(p?.['id']);
    const name = str(p?.['name']);
    if (id === undefined || name === undefined) continue;
    items.push({
      id,
      name,
      price: num(p?.['price']),
      currency: str(p?.['currency']),
      imageUrl: str(p?.['imageUrl']),
      url: str(p?.['url']),
    });
    if (items.length === MAX_PRODUCTS) break;
  }
  return items.length === 0 ? null : { kind: 'products', items };
}

function readOrder(bag: Record<string, unknown>): OrderCard | null {
  const o = record(bag['order']);
  if (o === null) return null;
  const number = str(o['number']);
  const statusLabel = str(o['statusLabel']);
  if (number === undefined || statusLabel === undefined) return null;
  return { kind: 'order', number, statusLabel, eta: str(o['eta']), trackingUrl: str(o['trackingUrl']) };
}

/**
 * `message.metadata` → the one commerce card it carries, or `null`. A flow
 * step sends at most one of `discount`/`products`/`order` per message
 * (flow-messages.ts's `botMessage`), so the first recognised, well-formed
 * key wins. Never throws.
 */
export function readFlowCard(metadata: unknown): FlowCard | null {
  const bag = record(metadata);
  if (bag === null) return null;
  return readDiscount(bag) ?? readProducts(bag) ?? readOrder(bag);
}

function selectText(node: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function renderDiscount(card: DiscountCard): HTMLElement {
  const codeBox = el('span', { attrs: { class: 'dh-discount-code' }, text: card.code });
  const copy = el('button', {
    attrs: { class: 'dh-discount-copy', type: 'button' },
    text: 'Copy code',
    on: {
      click: () => {
        if (typeof navigator === 'undefined' || !navigator.clipboard) {
          selectText(codeBox);
          return;
        }
        navigator.clipboard.writeText(card.code).catch(() => selectText(codeBox));
      },
    },
  });

  const children: HTMLElement[] = [];
  if (card.label !== undefined) children.push(el('div', { attrs: { class: 'dh-discount-label' }, text: card.label }));
  children.push(codeBox, copy);
  if (card.terms !== undefined) children.push(el('div', { attrs: { class: 'dh-discount-terms' }, text: card.terms }));

  return el('div', { attrs: { class: 'dh-flow-card dh-discount-card' }, children });
}

function renderProducts(card: ProductsCard): HTMLElement {
  const rows = card.items.map((item) => {
    const children: HTMLElement[] = [];
    if (item.imageUrl !== undefined && /^https?:/.test(item.imageUrl)) {
      children.push(
        el('img', { attrs: { class: 'dh-product-image', src: item.imageUrl, alt: item.name, loading: 'lazy' } }),
      );
    }
    children.push(el('span', { attrs: { class: 'dh-product-name' }, text: item.name }));
    if (item.price !== undefined) {
      const price = item.currency !== undefined ? `${item.currency} ${item.price}` : String(item.price);
      children.push(el('span', { attrs: { class: 'dh-product-price' }, text: price }));
    }
    return el('div', { attrs: { class: 'dh-product-item' }, children });
  });
  return el('div', { attrs: { class: 'dh-flow-card dh-products-card' }, children: rows });
}

function renderOrder(card: OrderCard): HTMLElement {
  const children = [
    el('div', { attrs: { class: 'dh-order-number' }, text: `Order ${card.number}` }),
    el('div', { attrs: { class: 'dh-order-status' }, text: card.statusLabel }),
  ];
  if (card.eta !== undefined) children.push(el('div', { attrs: { class: 'dh-order-eta' }, text: `ETA ${card.eta}` }));
  return el('div', { attrs: { class: 'dh-flow-card dh-order-card' }, children });
}

/** Builds the DOM for one card. */
export function renderFlowCard(card: FlowCard): HTMLElement {
  switch (card.kind) {
    case 'discount':
      return renderDiscount(card);
    case 'products':
      return renderProducts(card);
    case 'order':
      return renderOrder(card);
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @dhaam-ccrm/widget test flow-cards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/ui/flow-cards.ts packages/widget/test/flow-cards.test.ts
git commit -m "feat(widget): discount/products/order card reader and renderer"
```

---

## Task 12 (widget): Wire flow cards into the message list

**Files:**
- Modify: `packages/widget/src/ui/message-list.ts:30-34` (imports), `:826-953` (`createRow`, the `attachmentNode` area)
- Test: `packages/widget/test/message-list.test.ts`

**Interfaces:**
- Consumes: `readFlowCard`, `renderFlowCard` (Task 11).
- Produces: nothing new — every bot message carrying `metadata.discount`/`.products`/`.order` now renders its card inside the bubble, same message row a `metadata.buttons` chip row or an attachment already lives on.

- [ ] **Step 1: Write the failing test**

Add to `packages/widget/test/message-list.test.ts`, a new `describe` block (place it near the other `describe('rendering', ...)`/attachment blocks):

```ts
describe('flow cards (chatbot-workflows-commerce.md §8)', () => {
  it('renders a discount card from metadata.discount', () => {
    const { view } = build();
    view.render(
      state({
        messages: [
          message({
            senderId: 'bot_1',
            senderType: 'BOT',
            content: 'Here is a code for you',
            metadata: { flow: { runId: 'r1', stepId: 's1' }, discount: { code: 'SAVE10', label: '10% off', terms: 'Ends Friday' } },
          }),
        ],
      }),
      ME,
    );
    expect(view.log.querySelector('.dh-discount-code')?.textContent).toBe('SAVE10');
  });

  it('renders at most 3 product cards from metadata.products', () => {
    const { view } = build();
    const products = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Product ${i}`, price: 10 }));
    view.render(
      state({
        messages: [
          message({
            senderId: 'bot_1',
            senderType: 'BOT',
            content: 'A few options',
            metadata: { flow: { runId: 'r1', stepId: 's1' }, products },
          }),
        ],
      }),
      ME,
    );
    expect(view.log.querySelectorAll('.dh-product-item')).toHaveLength(3);
  });

  it('renders an order card from metadata.order', () => {
    const { view } = build();
    view.render(
      state({
        messages: [
          message({
            senderId: 'bot_1',
            senderType: 'BOT',
            content: 'Your order',
            metadata: { flow: { runId: 'r1', stepId: 's1' }, order: { number: 'ORD-1', statusLabel: 'Out for delivery' } },
          }),
        ],
      }),
      ME,
    );
    expect(view.log.querySelector('.dh-order-number')?.textContent).toBe('Order ORD-1');
  });

  it('renders nothing extra — not a crash — for malformed flow metadata', () => {
    const { view } = build();
    expect(() =>
      view.render(
        state({
          messages: [
            message({
              senderId: 'bot_1',
              senderType: 'BOT',
              content: 'Broken step',
              metadata: { flow: { runId: 'r1', stepId: 's1' }, order: { status: 'x' } },
            }),
          ],
        }),
        ME,
      ),
    ).not.toThrow();
    expect(view.log.querySelector('.dh-flow-card')).toBeNull();
  });

  it('leaves an ordinary text message with no card at all', () => {
    const { view } = build();
    view.render(state({ messages: [message({ senderId: 'bot_1', senderType: 'BOT', content: 'Hi there' })] }), ME);
    expect(view.log.querySelector('.dh-flow-card')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @dhaam-ccrm/widget test message-list.test.ts`
Expected: FAIL — no `.dh-flow-card` is ever rendered yet.

- [ ] **Step 3: Wire it into `createRow`**

In `packages/widget/src/ui/message-list.ts`, add the import alongside the existing `quick-replies.js` import (around line 33-34):

```ts
import { createQuickReplies, readSuggestions } from './quick-replies.js';
import type { QuickReplyChip } from './quick-replies.js';
import { readFlowCard, renderFlowCard } from './flow-cards.js';
```

In `createRow` (around line 831), add a new closure variable next to `attachmentNode`:

```ts
  let attachmentNode: HTMLElement | null = null;
  let cardNode: HTMLElement | null = null;
```

In `update()`, right after the existing attachment block (around line 950-953):

```ts
      if (attachmentNode === null && message.attachment !== undefined) {
        attachmentNode = renderAttachment(message.attachment);
        bubble.appendChild(attachmentNode);
      }

      if (cardNode === null) {
        const card = readFlowCard(message.metadata);
        if (card !== null) {
          cardNode = renderFlowCard(card);
          bubble.appendChild(cardNode);
        }
      }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @dhaam-ccrm/widget test message-list.test.ts`
Expected: PASS. Then run the full widget suite: `pnpm --filter @dhaam-ccrm/widget test`.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/ui/message-list.ts packages/widget/test/message-list.test.ts
git commit -m "feat(widget): render discount/products/order cards on bot messages"
```

---

## Task 13 (customer app): `analytics.middleware.ts` visitor events

**Files:**
- Modify: `dh-hyperlocal-customer-app-react/app/redux/analytics/analytics.middleware.ts`
- Test: `dh-hyperlocal-customer-app-react/app/redux/analytics/__tests__/analytics.middleware.test.ts` (new — no test currently exists for this file; this is the first one, using this repo's actual test runner, vitest, confirmed via `package.json`'s `"test": "vitest"`)

**Interfaces:**
- Consumes: `getWidget` from `@dhaam-ccrm/widget` (already exported from that package's `index.ts`, and already the retrieval path this repo's `mount()`-based `ChatWidgetMount.tsx` registers into — see `packages/widget/src/singleton.ts`: every `mount()` call registers into a cross-bundle global, so `getWidget()` finds the widget `ChatWidgetMount.tsx` mounted even though that component never imports `embed.ts`). `ChatWidget.sendEvent` (widget Task 9).
- Produces: nothing new — behavioural change only, in an already-open file.

**Judgment call — flag for the plan's requester:** the design doc's `search` branch says `widget.sendEvent('search', { query, results })`, but this app's `trackSearch` action (`analytics.actions.ts`) only ever carries `{ query }` — `SearchEventPayload` has no result-count field, and grepping every `dispatch(trackSearch(...))` call site in `Header.tsx`/`SearchSuggestions.tsx` confirms none is ever given one. The server's `EVENT_PROPS.search` requires BOTH `query` and `results` (`facts.ts:156`) — `boundEvent` drops the whole event if either is missing. Fabricating a `results` value (e.g. `0`) would be worse than not sending it: the "Search found nothing" flow template keys off `search.results === 0`, so a fabricated `0` would fire that flow on every search regardless of what was actually found. This task therefore sends `search` with `query` only, which the server will keep receiving but always drop (never reaches a flow) until a future change threads a real result count through `trackSearch`'s payload — flagged here rather than silently guessed at.

- [ ] **Step 1: Write the failing tests**

Create `dh-hyperlocal-customer-app-react/app/redux/analytics/__tests__/analytics.middleware.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEvent = vi.fn();
vi.mock('@dhaam-ccrm/widget', () => ({
  getWidget: () => ({ sendEvent }),
}));

vi.mock('../analytics.service', () => ({
  analyticsService: { dispatchEvent: vi.fn() },
}));

import { analyticsMiddleware } from '../analytics.middleware';
import { addToCart } from '../../slices/cartSlice';
import { fetchItemDetail } from '../../slices/itemDetailSlice';
import { trackSearch } from '../analytics.actions';

function runMiddleware(state: any, action: any) {
  const store = { getState: () => state, dispatch: vi.fn() };
  const next = vi.fn((a: any) => a);
  const invoke = analyticsMiddleware(store as any)(next);
  invoke(action);
  return next;
}

const EMPTY_AUTH_STATE = { auth: { user: null }, cart: { items: [] } };

beforeEach(() => {
  sendEvent.mockClear();
});

describe('analyticsMiddleware — cart_updated', () => {
  it('sends cart_updated with the item count after addToCart', () => {
    const state = { ...EMPTY_AUTH_STATE, cart: { items: [{ id: 'i1' }, { id: 'i2' }] } };
    const action = addToCart({
      item: { id: 'i1', name: 'Cap', price: 199 },
      storeId: 'store_1',
      storeInfo: { name: 'Store 1' },
    } as any);
    runMiddleware(state, action);
    expect(sendEvent).toHaveBeenCalledWith('cart_updated', expect.objectContaining({ items: 2 }));
  });

  it('sends one event per dispatch — two rapid add-to-carts send two events', () => {
    const state = { ...EMPTY_AUTH_STATE, cart: { items: [{ id: 'i1' }] } };
    const action = addToCart({ item: { id: 'i1', name: 'Cap', price: 199 }, storeId: 's1', storeInfo: {} } as any);
    runMiddleware(state, action);
    runMiddleware(state, action);
    expect(sendEvent).toHaveBeenCalledTimes(2);
  });

  it('never throws even if the widget is not mounted', () => {
    sendEvent.mockImplementationOnce(() => {
      throw new Error('should not happen, but the middleware must survive it anyway');
    });
    const state = { ...EMPTY_AUTH_STATE, cart: { items: [{ id: 'i1' }] } };
    const action = addToCart({ item: { id: 'i1', name: 'Cap', price: 199 }, storeId: 's1', storeInfo: {} } as any);
    expect(() => runMiddleware(state, action)).not.toThrow();
  });
});

describe('analyticsMiddleware — product_viewed', () => {
  it('sends product_viewed with productId and inStock after fetchItemDetail.fulfilled', () => {
    const action = fetchItemDetail.fulfilled(
      { itemId: 'item_1', data: { itemName: 'Cap', availableQty: 5 } as any },
      'req1',
      {} as any,
    );
    runMiddleware(EMPTY_AUTH_STATE, action);
    expect(sendEvent).toHaveBeenCalledWith('product_viewed', { productId: 'item_1', inStock: true });
  });

  it('reports out of stock when availableQty is 0', () => {
    const action = fetchItemDetail.fulfilled(
      { itemId: 'item_1', data: { itemName: 'Cap', availableQty: 0 } as any },
      'req1',
      {} as any,
    );
    runMiddleware(EMPTY_AUTH_STATE, action);
    expect(sendEvent).toHaveBeenCalledWith('product_viewed', { productId: 'item_1', inStock: false });
  });
});

describe('analyticsMiddleware — search', () => {
  it('sends search with the query only (no results count is available yet — see the task doc)', () => {
    runMiddleware(EMPTY_AUTH_STATE, trackSearch({ query: 'blue shoes' }));
    expect(sendEvent).toHaveBeenCalledWith('search', { query: 'blue shoes' });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run app/redux/analytics/__tests__/analytics.middleware.test.ts` (from `dh-hyperlocal-customer-app-react`)
Expected: FAIL — `sendEvent` is never called yet.

- [ ] **Step 3: Add the three branches**

In `dh-hyperlocal-customer-app-react/app/redux/analytics/analytics.middleware.ts`, add the import at the top:

```ts
import { getWidget } from '@dhaam-ccrm/widget';
```

Add a small helper right below the imports, and call it from each of the three existing branches — edit `addToCart.match(action)` (currently lines 47-57):

```ts
// The widget instance is reached the same way ChatWidgetMount.tsx reaches
// it: `mount()` (packages/widget/src/index.ts) registers into a cross-bundle
// singleton regardless of whether the caller went through embed.ts, so
// `getWidget()` finds it here too. Defensive: a widget not yet mounted (or a
// call that somehow throws) must never break analytics or the app around it.
function sendVisitorEvent(name: string, props: Record<string, unknown>): void {
    try {
        getWidget()?.sendEvent(name, props);
    } catch (err) {
        if (process.env.NODE_ENV === 'development') {
            console.error('Chat visitor event error:', err);
        }
    }
}

export const analyticsMiddleware: Middleware = store => next => action => {
```

Edit the `addToCart.match(action)` branch:

```ts
        // Add To Cart
        else if (addToCart.match(action)) {
            const { item, storeId, storeInfo } = action.payload;
            analyticsService.dispatchEvent('add_to_cart', {
                item_id: item.id,
                item_name: item.name,
                store_id: storeId,
                store_name: storeInfo?.name,
                quantity: 1,
                price: item.price
            }, userId);
            // `state` (not a fresh store.getState() call) — already captured
            // above, after next(action), same value the add_to_cart
            // dispatchEvent call just above uses.
            sendVisitorEvent('cart_updated', { items: (state.cart?.items ?? []).length });
        }
```

Edit the `fetchItemDetail.fulfilled.match(action)` branch:

```ts
        // View Item (fetchItemDetail.fulfilled)
        else if (fetchItemDetail.fulfilled.match(action)) {
            const { itemId, data } = action.payload;
            analyticsService.dispatchEvent('view', {
                item_id: itemId,
                item_name: data.itemName
              
            }, userId);
            sendVisitorEvent('product_viewed', {
                productId: itemId,
                ...(typeof data.availableQty === 'number' ? { inStock: data.availableQty > 0 } : {}),
            });
        }
```

Add the `trackSearch.match(action)` call in the explicit-analytics-actions block:

```ts
        // 1. Explicit Analytics Actions
        if (trackView.match(action)) {
            analyticsService.dispatchEvent('view', action.payload, userId);
        } else if (trackAddToCart.match(action)) {
            analyticsService.dispatchEvent('add_to_cart', action.payload, userId);
        } else if (trackPurchase.match(action)) {
            analyticsService.dispatchEvent('purchase', action.payload, userId);
        } else if (trackSearch.match(action)) {
            analyticsService.dispatchEvent('search', action.payload, userId);
            // NOTE: `results` is deliberately omitted — SearchEventPayload
            // carries no result count anywhere this action is dispatched
            // (Header.tsx, SearchSuggestions.tsx), and chat-service-node's
            // EVENT_PROPS.search requires it, so this event is kept by the
            // server as telemetry but never reaches a flow until a real
            // count is threaded through. Fabricating one (e.g. 0) would be
            // worse: "Search found nothing" keys off results === 0 and would
            // fire on every search. See this task's plan for the full call.
            sendVisitorEvent('search', { query: action.payload.query });
        } else if (trackSearchImpression.match(action)) {
            analyticsService.dispatchEvent('search-impression', action.payload, userId);
        }
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm vitest run app/redux/analytics/__tests__/analytics.middleware.test.ts` (from `dh-hyperlocal-customer-app-react`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/redux/analytics/analytics.middleware.ts app/redux/analytics/__tests__/analytics.middleware.test.ts
git commit -m "feat(analytics): send cart_updated/product_viewed/search visitor events to chat"
```

---

## Self-Review

**1. Spec coverage.**
- E1 (visitor events, 4 names, `visitor.event` frame): Core Tasks 1, 2, 3, 6.
- E2 (invites — receive push, render bubble, accept via `inviteId` on hello, dismiss): Core Tasks 1, 2, 4, 5, 6; Widget Tasks 7, 9.
- E3 (discount/products≤3/order cards): Widget Tasks 11, 12.
- E4 (exit-intent one-listener, two-effects): Widget Task 8.
- E5 (customer app cart_updated/search/product_viewed): Customer App Task 13.
- "Not in scope" items (`onAction`, `checkout_error`/`custom`, nexusai `cards` vocabulary) are explicitly not built anywhere in this plan — confirmed by grep-level review of every task above; nothing reads or writes `metadata.cards`.
- Errors/safety section ("never throws", "no personal data in props", "a bubble that fails to render is simply not shown"): every new entry point (Tasks 3, 6, 9, 10, 13) has an explicit never-throws test; Task 3's normalizer is the enforcement point for props; Task 7/12's readers return `null`/skip on anything malformed rather than partially rendering.
- Testing section's four bullets (validators, client tests, widget fake-socket integration tests, customer-app unit tests) are each covered by name in Tasks 2/3/6, 6, 8/9/10/12, 13 respectively.

**2. Placeholder scan.** No "TBD"/"TODO"/"add appropriate handling" strings appear in any step above; every step's code block is complete, real TypeScript that compiles against the interfaces defined in earlier tasks. The one place this plan deliberately ships something incomplete (Task 13's `search` event missing `results`) is not a placeholder — it is a working, tested behavior with its limitation stated as a code comment and as this plan's own judgment-call callout, not a TODO left for later.

**3. Type consistency.** Traced end to end: `VisitorEventPayload`/`FlowInvitePayload`/`FlowInviteDismissedPayload` (Task 1) are the exact types `validate.ts` (Task 2), `visitor-event.ts` (Task 3), `events.ts` (Task 4), and `create-chat-client.ts` (Task 6) all import and use — no field renamed or reshaped between tasks. `ConnectionController.carryInvite` (Task 5) is called with that exact name and signature from `create-chat-client.ts`'s `acceptInvite` (Task 6). `store.client.sendVisitorEvent`/`.acceptInvite`/`.dismissInvite` (Task 6) are called with those exact names from `widget.ts` (Tasks 8, 9). `createInviteBubble`'s `onAccept(inviteId: string)`/`onDismiss(inviteId: string)` (Task 7) match the callbacks `widget.ts` (Task 9) passes. `readFlowCard`/`renderFlowCard`/`FlowCard` (Task 11) are the exact names and shapes `message-list.ts` (Task 12) imports and switches over.

**4. Review Focus.** All five items listed above are each pinned by a named test in their owning task — none are left as prose-only concerns. No further gaps found on this pass.
