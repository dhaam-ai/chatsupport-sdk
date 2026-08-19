# Architecture Decision Records

Four decisions define the v2 chat SDK's wire behaviour. They were resolved on
2026-08-17, are recorded in the PRD's decisions log (`docs/spec/chat-sdk-v2-prd.md`
§0.5) as **binding constraints** rather than proposals, and each one was chosen against
something specific and verifiable in the v1 client.

| ADR | Decision | Chosen against |
|---|---|---|
| [0001](0001-client-ulid-is-the-permanent-message-id.md) | The client-generated ULID **is** the permanent message id | v1's two overlapping dedup mechanisms — a `clientMessageId` ack mapping *and* a 10-second content-matching echo suppressor |
| [0002](0002-per-session-seq-with-inline-replay-on-resume.md) | A monotonic per-session `seq`, replayed inline on resume | v1's asymmetric `CONNECTION_ACK` handshake and its coaxing workaround; timestamp ordering across four field aliases |
| [0003](0003-in-place-connection-reauth.md) | Token refresh happens in place, on the open socket | v1's static config token, `includes('expired')` detection, and page-reload recovery |
| [0004](0004-one-wire-format-zero-coercion-in-core.md) | One wire format; core ships zero coercion | v1's `normalize*` layer, written twice, absorbing integer/string and camelCase/snake_case drift |

## Why these are worth reading

The v1 tree (`src/`, `dist/`) is reference-only and scheduled for removal. These records
— together with PRD §12, "Grounded in v1 Reality" — are what survives it: the account of
**what was actually wrong**, with file and line citations taken while the code was still
present, so the reasoning outlives the evidence. Each ADR states its costs as plainly as
its benefits, because every one of these decisions bought something by giving something
up.

## Convention

One file per decision, numbered, never renumbered. Status, context (the evidence),
decision, consequences — including what the decision costs. A superseded ADR is marked
superseded in place and left where it is; the record of a decision we later reversed is
worth more than a tidy directory.
