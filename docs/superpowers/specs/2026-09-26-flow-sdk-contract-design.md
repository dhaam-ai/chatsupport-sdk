# SDK integration for the server-side flow engine (Part 1) — Design

Source contract: `chat-service-node/docs/specs/chatbot-workflows.md` §9 and §11 (Part 1),
and Part 2 (`chatbot-workflows-commerce.md`, out of scope here, later).

## Ground rule from the contract

Flows run on chat-service-node. **The SDK never executes flows and never reads a graph** (P1 §1, §11.3).
The SDK (a) tells the server where the visitor is, and (b) renders what the bot sends.
Today's SDK already renders `metadata.options` as chips and sends the tapped label as text, so
"The chat opens" flows work unchanged; this work adds what the contract asks on top.

## Scope (approved)

- **R.** Remove the client-side offline flow runner (`src/flow/*`, `ui/flow-view.ts`, `offlineFlowFor`, their wiring and CSS).
  It contradicts P1 §11.3, and v2 flows reach the widget with `steps: []`, so it could never run for them.
  Behaviour after removal: "Collect a message" while closed shows the built-in leave-a-message form (unchanged when no flow existed).
  "Show a message", "Hide the widget", consent, file uploads etc. are untouched.
- **A1. Page context.** `connection.hello.context` and a new `context.update` client frame (core), a public
  `setPage({label, url, store, attributes})` on the widget, a `page` config option, and `data-page-label` / `data-page-url`
  for script-tag installs. With nothing set the SDK sends `url` only (P1 §11.1 item 3).
- **A2. Buttons.** A bot message with `metadata.buttons` renders tappable buttons under the newest message only;
  a tap sends `message.send` with `content = label` and `metadata { kind:'flow_reply', runId, stepId, buttonId }`, then the buttons go.
  Flow buttons are NOT filtered by the handoff-keyword list (the merchant wrote them; that filter exists for LLM-generated chips),
  and a `flow_reply` send does not trigger the widget's own keyword escalation (the engine owns "wants a person").
  No `buttons` but `options`: today's chips, untouched.
- **A3. Input hints.** `metadata.input.type` (`email`, `phone`, `number`, `order`) sets the composer's keyboard and placeholder
  while that bot message is the newest; typing stays allowed.
- **C. Customer app** (`dh-hyperlocal-customer-app-react`): call `setPage` from the mounted widget on route changes with the
  contract's label vocabulary.

Not in scope now: Part 2 (`visitor.event`, `flow.invite`, product/discount/order cards, `onAction`).

## Design

### Core (`packages/core`)
- `protocol/frames.ts`: `VisitorContext { label?, url?, attributes?, store? }`, `ContextUpdatePayload = VisitorContext & { sessionId? }`,
  `ConnectionHelloPayload.context?: VisitorContext`, `'context.update'` added to the client frame catalogue and payload map.
- `protocol/validate.ts`: a client-frame validator for `context.update` with the server's limits
  (label `^[a-z0-9][a-z0-9_-]{0,63}$`, url ≤ 2048, ≤ 20 attributes with key `^[A-Za-z0-9_.-]{1,40}$` and string values ≤ 200, store ids ≤ 80).
- `connection/controller.ts`: `setPageContext(ctx)` latches the context and includes it as `context` on every hello (like `contactInfo`).
- `client`: `client.setPageContext(ctx)` — normalises, drops invalid input with a logger warning (a bad context must never break chat),
  and when connected sends `context.update` **only if the normalised context changed**, coalescing bursts (500 ms) and staying
  under 8 updates per rolling minute (server cap is 10). Never throws.

### Widget (`packages/widget`)
- `config.ts`: `WidgetConfig.page?: PageContext`; `ChatWidget.setPage(ctx)`.
- `attributes.ts`: `data-page-label`, `data-page-url` → `config.page`.
- Default: when no page was ever set, send `{ url: location.href }` (http/https only, ≤ 2048 chars, otherwise omitted).
- `ui/quick-replies.ts`: `readQuickReplies` gains a structured reader for `metadata.buttons` (id + label, max 6, label ≤ 80, dedup by id);
  chips keep their `buttonId`.
- `ui/message-list.ts` / `widget.ts`: chip tap → `composer.submit(text, { metadata })`; `onSend(text, extra)` merges the extra metadata
  with the reply metadata and skips keyword escalation when `extra.metadata.kind === 'flow_reply'`.
- `ui/composer.ts`: `setInputHint(hint | null)` → `inputmode`, `enterkeyhint`, `autocomplete`, placeholder; cleared when the newest message has no `input`.
- All text stays plain text (`textContent`); no HTML anywhere.

### Customer app
- `ChatWidgetMount.tsx`: after mount, and on every `usePathname()`/search-param change, call `widget.setPage({label, url, store})`.
  Labels: `/home`→`home`, `/stores/[id]`→`store` (with `store.id`), `/products/**`→`product`, `/cart`→`cart`,
  `/checkout`→`checkout`, `/payment/**`→`payment`, `/tracking/[orderId]`→`order`, `/profile`→`account`, anything else → no label (url only).

## Errors and safety
- A malformed context is dropped client-side; hello is never blocked by context (server drops bad context too).
- Buttons/hints come from server metadata: parsed defensively, ignored when malformed.
- No personal data in `attributes` (contract §11.3); the SDK sends none itself.

## Testing
Unit tests per module (validator, controller hello, client update rules incl. dedupe and rate cap, button parsing, input hints),
widget integration tests with the existing fake socket (hello carries context; `setPage` sends one `context.update`;
buttons render on the newest bot message only and send `flow_reply`; keyword escalation is skipped for `flow_reply`;
input hint applied and cleared), and the full widget + core suites. Customer app: unit test for the route → page mapping.

## Risks
- Backend engine flag off → nothing changes for visitors (contract §11.5).
- The customer app and any other host receive this only after repack + refresh + redeploy.
