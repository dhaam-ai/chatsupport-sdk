---
"@dhaam-ccrm/widget": minor
---

`embedForm` — the same web form in an iframe, for full style isolation.

A third artifact, `dist/form-embed.js`, that creates one `<iframe>` pointing at
the console's hosted form page and tracks the height that page posts up, so the
frame never shows a scrollbar of its own. Available as
`window.DhaamFormEmbed.embed(target, options)` and as `embedForm` from the
package. For a host stylesheet that reaches into a shadow root with
`!important`, or a compliance rule that wants the form on its own origin.

`hostedOrigin` is required and validated as an `http:`/`https:` origin — this
package has no canonical console origin to default to, and `ws://` or `ftp://`
are canonical origins an `<iframe>` can never load. Height messages are accepted
only from that origin **and** only from that exact frame, and only when the
payload is `{ type: 'dhaam-form:resize', height }` with a finite, non-negative
height; everything else on the `message` channel is ignored silently, because a
page with two embeds on it sees both of their traffic and that is not an error.

Under a strict host Content-Security-Policy the embed adds exactly one
directive, `frame-src <hostedOrigin>`. It needs no `style-src 'unsafe-inline'` —
every style goes through the CSSOM — nothing is evaluated, and this side makes
no request, so no `connect-src`. A merchant loading `form-embed.js` from our CDN
still needs whatever `script-src` already admits that file; the claim is that
this bundle adds no *new* script-src, style-src or connect-src grant, not that
`frame-src` is the only directive a page ends up with.

`options.onUnreachable` is the one signal for the failure this surface is
otherwise silent about — a typo'd `hostedOrigin`, a hosted page served with
`X-Frame-Options: SAMEORIGIN`, a console that is down. It fires once,
`EMBED_UNREACHABLE_TIMEOUT_MS` (10s) after the embed goes onto the page, if no
valid height ever arrived; it removes nothing and resizes nothing. The default
is nothing at all: no console output, and no timer for a caller who did not ask.

The frame half is `mountForm`'s new `parentOrigin` option plus
`parentOriginFromLocation(location.search)`, which is the one line a hosted page
needs to join the protocol. Given an origin it cannot validate it posts nothing
and never falls back to `'*'`. Existing `mountForm` callers are unaffected: with
no `parentOrigin`, nothing is observed and nothing is posted.

The hosted page's own obligations — it must not be served with
`X-Frame-Options: DENY|SAMEORIGIN`, it should set `frame-ancestors` from the
validated `?origin=`, and every response including error pages must post a
height — are written out as rule 4 in the header of `src/form-embed.ts`, which
is the spec of record for `GET /f/<publishableKey>`.
