---
"@dhaam-ccrm/core": minor
"@dhaam-ccrm/rest": minor
"@dhaam-ccrm/js": minor
"@dhaam-ccrm/react": minor
"@dhaam-ccrm/angular": minor
"@dhaam-ccrm/widget": minor
---

Identify a logged-in user to the CRM on first connect.

A host that knows who its user is can now say so, and the backend upserts a
`Contact` for them. The whole feature is opt-in through one new field — nothing
fires for a guest, and nothing fires for an integrator who does not set it.

**`@dhaam-ccrm/core`** gains two flat optional `ChatClientConfig` fields,
`identityProfile?: IdentityProfile` and `identitySync?: IdentitySync`, plus
type-only barrel exports for both. Core still makes no HTTP call of its own:
`identitySync` is an injected seam, exactly like `uploader` and `sessionActions`.
`createChatClient` fires `sync()` once per client instance on the first
`connect()`, only when **both** fields are present, behind a
fingerprint-plus-TTL dedup gate so an unchanged profile does not re-send. The
call is fire-and-forget with a single jittered retry — it is never awaited by
anything that gates the UI, and a rejection cannot surface in chat.

**`@dhaam-ccrm/rest`** gains `createIdentitySync(client)`, which POSTs the
profile to `/identify` and unwraps the `{ success, data }` envelope. It follows
the four existing adapter factories: generic over the wire type with an inline
structural return type, so it satisfies core's seam structurally and `rest`
still has no dependency on `core`.

**`@dhaam-ccrm/js`**, **`@dhaam-ccrm/react`** and **`@dhaam-ccrm/angular`**
re-export the `IdentityProfile` and `IdentitySync` types.

**`@dhaam-ccrm/widget`** gains `WidgetIdentity.profile`. Supplying it — and only
supplying it — turns identify on; the widget maps it onto core's two fields and
reuses the same `RestClient` as every other adapter. `resolveConfig` neither
validates nor logs any profile value.

Type-only additions in `core`, so the public runtime barrel is unchanged.
