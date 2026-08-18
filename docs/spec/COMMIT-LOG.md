# Commit log — v2 SDK build

The 89 commits below were squashed into one to clear GitHub push protection,
which flagged two synthetic `sk_…` test fixtures in intermediate commits. The
full granular history is preserved locally on branch `backup-before-secret-rewrite`.

```
829eafb feat(state): add binding-facing ChatState shapes
1bb569b feat(state): add deepFreeze for snapshot immutability
21b878a feat(state): add ChatEventMap covering the §6.5 catalog
9d3facb feat(state): add typed event emitter for the on() primitive
ff8da67 feat(state): add the observable store
71f478d feat(state): add state barrel and §6.5 catalog round-trip suite
e3af817 fix: give attachment exactly one canonical location
05cff92 feat(presence): add injectable time primitives and outbound intent types
ea09839 feat(presence): implement typing indicators with auto-clear and outbound throttle
1bd3dfc chore(plan): add B7, multi-instance fan-out for /v2/ws
1a6e617 feat(presence): implement read watermarks with enforced monotonicity
ae06aaf feat(presence): implement presence registry for update/set/query
da086d5 feat(presence): add coordinator and module barrel
9a382fb Merge branch 'worktree-agent-ac58daee59e825454' into feat/framework-agnostic-core
0b637c1 fix(state): give presence one canonical home in ChatState
5a218be chore(plan): add B8, authenticate v1 REST chat routes
e01ba1e feat(transport): add monotonic ULID generator
70f269e feat(transport): add injectable socket seam, redacting logger, stub socket
f247a5b feat(transport): decode inbound frames through four rejection gates
0d8a562 feat(transport): add close classification and pending-ack registry
181ae06 feat(transport): add heartbeat monitor for dead-peer detection
83c33ed feat(transport): add WebSocketTransport and module barrel
539a5e8 fix(transport): discard a socket displaced by a re-entrant connect
9b2dbdd fix(transport): clear the socket handle before the factory runs
88d6dc3 chore(plan): add B9 for the two remaining auth bypasses
1fff7be Merge branch 'worktree-agent-ac5d32b0075b72a83' into feat/framework-agnostic-core
3032a96 fix(transport): close the socket a reconnect supersedes
2342356 feat(connection): add §8.1 state transition table with illegal-edge guard
4bcd09e chore(plan): add B10 for the v1 socket.io IDOR twins
0291ca8 feat(connection): drive the socket lifecycle, reconnect, and suspend
beb8679 feat(connection): resume from the last applied seq with gap detection
a8c26a2 feat(connection): refresh tokens in place, reconnect transparently on fallback
bc43d09 test(connection): prove socket lifecycle against the real transport, add barrel
ec35801 fix(connection): contain a rejected refresh chain and report cause first
ca8b332 Merge branch 'worktree-agent-af89971a2e85c7a71' into feat/framework-agnostic-core
00863c4 feat(core): add connection state machine
d64c66c feat(queue): add durable entry shape and a total, per-entry codec
d52f822 feat(auth): reject secret keys where a publishable key belongs
646a139 feat(queue): isolate storage failure handling behind one save/load seam
a1cb8f0 feat(auth): adapt real token-endpoint shapes to the TokenProvider seam
11ee025 feat(auth): add credential redaction and the auth module barrel
c1c30fc feat(core): add credential hygiene at the SDK edge, and stop leaking host errors
d6af2e8 feat(queue): deliver FIFO per session, replaying the original ULID
c9f23d7 feat(queue): add module barrel and direct retention tests
6a525c2 Merge branch 'feat/framework-agnostic-core' into worktree-agent-a9ddeca77120f355b
059d085 feat(queue): add module barrel and cover the retention rule directly
e1ecd3f refactor(queue): default the clock to the canonical systemClock
5b600b8 feat(transport): let a replayed frame keep its original id
0b8acef feat(state): represent a permanently-failed send
92cd876 feat(messages): add seq-ordered, ULID-deduped message list algebra
5668581 feat(messages): add optimistic sendMessage with queue-backed delivery state
1021b30 feat(messages): add backward-cursor pagination via loadMore
b3eb904 feat(messages): add upload-then-announce attachments
1a480f8 feat(messages): apply inbound message.new and add the module barrel
a314c7a test(messages): cover retention eviction and the early-outcome leak guard
af01cfb feat(core): add message operations
e846a8d chore(plan): add B11, unique constraint on (chatSessionId, seq)
8b9ef67 fix(openapi): resolve the server base path to the one the service serves
026ae31 feat(client): add public ChatClient contract and session-snapshot mapping
2ef5aa5 feat(client): wire createChatClient and rewrite the public barrel
46ae24d fix(client): rehydrate optimistic messages from a restored offline queue
690d5b3 test(client): add the end-to-end public-API test and the barrel surface test
2e22215 docs(client): record the hasMore/cold-start pagination decision in code
71dd3af feat(core): assemble createChatClient and the public barrel
a6f8b53 feat(auth): namespace the key prefix to dhpk_/dhsk_
7026839 feat(rest): add fetch-based adapters for core's injected seams
6c7e7b6 feat(react): add the React binding
dea1e2d chore(plan): close B3, B4 and B6 as absorbed
747c08e feat(demo): scaffold reference integration and wire ChatClientConfig
6a3ddd7 feat(demo): add the token endpoint and single-process server
9481791 feat(demo): add message list, composer, typing and unread UI
74c95df docs(demo): add README with exact run commands and integration findings
8a60d77 chore: record examples/demo in the lockfile
378400b feat(node): scaffold @dhaam-ccrm/node with secret-key validation
75e2d1a test(core): add §15 source scanners and the zero-dependency guard
7220033 ci: gate every PR on build, typecheck, test and a credential scan
4a37375 ci: wire the changesets release path, dry-run safe by default
04cd789 test(core): guard that core touches no DOM global at module scope
92b72b2 feat(node): verify X-ChatSDK-Signature webhooks
8417439 ci: fail when a test file is in no tsconfig program
a21d950 test(core): guard that no secret key is reachable through core
dd79638 test(core): guard that no credential or message content reaches a log line
be3f888 feat(node): mint tokens, paginate history, and expose the client
4e040bd test(core): assert the barrel's exact export surface, and fix test-only types
80a1eeb docs(node): README, changeset, and structural packaging guards
be8becc Merge branch 'worktree-wf_a264f4ba-eec-1' into feat/framework-agnostic-core
dab98a1 Merge branch 'worktree-wf_a264f4ba-eec-2' into feat/framework-agnostic-core
503f307 Merge branch 'worktree-wf_a264f4ba-eec-3' into feat/framework-agnostic-core
756ef49 docs: add STATE.md as the cold-resume index
```
