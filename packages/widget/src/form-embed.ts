// `embedForm` — the web form in an `<iframe>`, from the MERCHANT's side.
//
// A merchant who wants full style isolation — not a shadow root inside their
// page but a separate document — drops this script on their site. It creates
// one `<iframe>` pointing at the console host's hosted form page, and the page
// inside reports its height up so the frame never shows a scrollbar of its
// own. That is the whole job; the form itself is rendered by `form.ts` inside
// the frame, on the console host, and this file never sees it.
//
// ── This file has NO imports, and that is load-bearing ────────────────────
//
// It is bundled on its own to `dist/form-embed.js`, and the claim that
// artifact makes is that it contains this and nothing else: no form UI, no
// client, no core. `scripts/bundle.mjs` fails the build if a second module
// reaches it. The one predicate it would otherwise share with `form.ts` — the
// secret-key prefix test — is duplicated here for the same reason `form.ts`
// duplicates it from `auth.ts`, and `test/form-embed.test.ts` pins it to
// core's answer so the copy cannot drift quietly.
//
// ══════════════════════════════════════════════════════════════════════════
// THE PROTOCOL — the contract the hosted page, `GET /f/<publishableKey>` on
// the console host, is built against. Both halves live in this package:
// this file is the host half, `form.ts`'s `parentOrigin` is the frame half.
// ══════════════════════════════════════════════════════════════════════════
//
// 1. The URL the iframe is pointed at
//
//      <hostedOrigin>/f/<encodeURIComponent(publishableKey)>
//          ?embed=1&origin=<encodeURIComponent(location.origin)>
//
//    hostedOrigin   REQUIRED and explicit — there is no canonical console
//                   origin baked into this package. An `http:`/`https:`
//                   ORIGIN and nothing more: scheme://host[:port], canonical,
//                   which is to say `new URL(x).origin === x`. No path, no
//                   trailing slash, no default port spelled out, and no other
//                   scheme — `ws://`, `wss://` and `ftp://` are canonical
//                   origins an `<iframe>` can never load, so accepting one
//                   buys the silent empty box of rule 4(c). Refused
//                   otherwise, so that rule 3(a) below can be a plain string
//                   equality.
//    embed=1        Tells the page it is inside a frame — render no chrome,
//                   zero body margin, and post heights.
//    origin=…       The EMBEDDER's origin, exactly as `location.origin` gave
//                   it. The page hands it to `mountForm({ parentOrigin })`,
//                   which posts to that origin and never to `'*'`;
//                   `parentOriginFromLocation(location.search)` in `form.ts`
//                   reads and validates it in one line. It is ALSO the input
//                   rule 4(b) wants for a per-request `frame-ancestors`: the
//                   page has to parse and validate it either way.
//
//                   A page opened from `file:` or in a sandbox has the opaque
//                   origin `"null"`, which fails validation on the frame side,
//                   so such a page never receives a height (and never could,
//                   without `'*'`). That is not benign — rule 4(c) says what
//                   it actually looks like.
//
// 2. The message the page posts — frame → host, and only in that direction —
//    with `window.parent.postMessage(message, parentOrigin)`:
//
//      { type: 'dhaam-form:resize', height: <number> }
//
//    height         The form host element's border-box height in CSS px,
//                   `Math.ceil`ed, finite, ≥ 0. Posted once after mount and
//                   again on every size change (`ResizeObserver` on the host
//                   element, so it is content-driven and cannot feed back on
//                   itself the way a document `scrollHeight` under a
//                   `height: 100%` rule would). The hosted page therefore
//                   gives that element no outside margin; whatever surrounds
//                   it is not counted.
//
// 3. What the host does with a `message` event. ALL FOUR, or the event is
//    ignored silently — no console output, because a page with two embeds on
//    it sees the other one's traffic and that is not an error:
//
//      (a) event.origin === hostedOrigin          — the page we created, not a lookalike
//      (b) event.source === iframe.contentWindow  — OUR frame, not another frame on the same host
//      (c) event.data is an object with type === 'dhaam-form:resize'
//      (d) event.data.height is a finite number ≥ 0
//
//    then `iframe.style.height = \`${Math.ceil(height)}px\``. Nothing else in
//    the payload is read, and nothing is ever posted host → frame.
//
//    ⚠️ `0` is a LEGAL height and is applied as `0px`, collapsing the frame to
//    nothing — strictly worse than the 320px letterbox rule 4(c) exists to
//    prevent, because an invisible frame does not even look broken. It is
//    rejected as a value only when negative or non-finite. The way a page
//    posts `0` by accident is measuring an element before layout has run, so
//    measure after layout (a `ResizeObserver`, or `requestAnimationFrame`),
//    and never post a height you have not looked at.
//
//    VERSIONING: there is none, deliberately. Rule 3 reads exactly `type` and
//    `height` and ignores every other key, so a later protocol may ADD keys
//    and both halves keep working across independent deploys — a merchant's
//    cached `form-embed.js` against a newly deployed page, or the reverse. A
//    change that needs to REMOVE or REINTERPRET either key is not compatible
//    and needs a new `type` string, not a version field.
//
// 4. WHAT THE HOSTED PAGE MUST DO. This block is the spec of record for
//    `GET /f/<publishableKey>`. `docs/spec/chat-sdk-v2-prd.md` does not mention
//    the web form at all, and before this block neither `frame-ancestors` nor
//    `X-Frame-Options` appeared anywhere in this repository — the README now
//    carries a short version of what follows, and nothing else does. If an
//    obligation is not written in one of those two places it is not written
//    down anywhere, which is why the four below are stated as MUST/SHOULD
//    rather than left to whoever wires the route up.
//
//    (a) The page MUST NOT be served with `X-Frame-Options: DENY` or
//        `X-Frame-Options: SAMEORIGIN`.
//
//        This is the failure to expect, because nobody chooses it. Put the
//        hosted page behind any default security middleware — helmet,
//        Django's `XFrameOptionsMiddleware`, Rails' default headers, the
//        nginx hardening snippet everyone pastes — and `SAMEORIGIN` arrives
//        on its own. The browser then refuses the frame outright: nothing in
//        it runs, no height is ever posted, and rule 3's silence guarantees
//        the merchant sees an empty 320px box with no diagnostic anywhere,
//        on this side or theirs. Whoever hardens that route has to exempt it
//        deliberately, which means knowing it exists.
//
//    (b) The page SHOULD send `Content-Security-Policy: frame-ancestors`,
//        naming the `?origin=` ONLY AFTER CHECKING IT AGAINST THE TENANT'S
//        REGISTERED ORIGINS — and refusing the request, or sending
//        `frame-ancestors 'none'`, when it does not match.
//
//        ⚠️ Echoing `?origin=` back unchecked is a security NO-OP that reads
//        like access control, and is the mistake to expect here. That
//        parameter is supplied by the framing page: a hostile page frames
//        with `?origin=https://evil.example`, and a page that simply
//        validates its SYNTAX and reflects it answers
//        `frame-ancestors https://evil.example` — permitting precisely the
//        page that asked to be permitted. "Validated" everywhere else in this
//        file means canonical-origin SYNTAX (rule 1,
//        `parentOriginFromLocation`); here it must additionally mean
//        AUTHORIZED.
//
//        The list to check against already exists and is already enforced one
//        route over: `tenants.allowed_origins`, read per tenant and applied by
//        `GET /widget/form` — which answers 403 `ORIGIN_NOT_ALLOWED` to a
//        request from an origin not on it (chat-service
//        `api/rest/routes/widget-public.routes.ts`, the `originAllowed` call
//        in that handler). An empty list there means unrestricted, so this
//        check must degrade the same way that one does rather than locking
//        out every tenant who has not filled it in.
//
//        Why it matters that this is the console's own check: the only other
//        origin check in the system is rule 3 above, and rule 3 runs as
//        JavaScript ON THE EMBEDDER'S PAGE, under the embedder's control. It
//        protects an HONEST embedder from a third party's messages. It can
//        never protect the console from the embedder, because a hostile
//        embedder does not run this file at all.
//
//        It is not the merchant's `frame-src`, and one cannot substitute for
//        the other: `frame-src` is the embedder's policy about what it will
//        load, `frame-ancestors` is the console's policy about who may frame
//        it. Both, or neither is enforced end to end.
//
//    (c) EVERY response served at `/f/<publishableKey>` MUST post a height —
//        ERROR PAGES INCLUDED. A 401 for a revoked key, a 404 for an unknown
//        one, a 429, a 500, the edge's own error page: each of those is a
//        document sitting inside somebody's contact page, and a document that
//        posts no height is not a frame at its natural size. It is a
//        `EMBED_MIN_HEIGHT_PX` clipping of itself with NO scrollbar —
//        `scrolling="no"` and `overflow: hidden` are both set unconditionally
//        below — so on anything taller than 320px the submit button cannot be
//        reached and no scroll gesture will reveal it.
//
//        This is also the requirement that makes `warnUnlessPublishable`'s
//        "the hosted page is the authority on the key" true rather than
//        aspirational. An unrecognised prefix is allowed through here on the
//        promise that the hosted page answers for it visibly; an error page
//        rendered by error middleware that never runs the SDK answers for it
//        in a 320px letterbox. One inline script on the error template,
//        posting `{ type: 'dhaam-form:resize', height }` to the validated
//        `?origin=`, discharges it. That script needs none of this SDK.
//
//    (d) What is measured is `root.host`'s BORDER BOX — the form element, and
//        nothing around it. Page chrome above or below it (a logo, the
//        merchant's branding, a wrapper's padding, a cookie bar) is NOT in
//        the number, and under `overflow: hidden` it is clipped by exactly
//        its own height. A branded hosted page is the most likely thing to
//        build here and the likeliest way to get this wrong, because it looks
//        right locally — a developer opening `/f/<key>` directly sees it at
//        full window height, where nothing is clipped.
//
//        Neither obvious remedy works, so do not reach for them. You cannot
//        put the chrome INSIDE the measured element: `root.host` is an
//        SDK-created custom element whose shadow root holds only our own
//        `<style>` and `.dh-form-root`, and there is no `<slot>` anywhere in
//        it (`ui/form-root.ts`, `ui/form-styles.ts`), so a light-DOM child
//        appended to it does not render at all. Nor can you add to the number
//        afterwards: while `parentOrigin` is set, `installResizeReporter`
//        owns the posting and its `ResizeObserver` overwrites anything you
//        post on the next content change.
//
//        The escape is the one rule 4(c) already gives error templates: OMIT
//        `parentOrigin` from `mountForm`, and post the heights yourself —
//        `{ type: 'dhaam-form:resize', height }` to the validated `?origin=`,
//        measuring whatever outermost element actually contains your chrome.
//        A few lines, and none of them need this SDK. Take that path as soon
//        as the page is more than the form.
//
// ── The merchant's Content-Security-Policy ────────────────────────────────
//
// Under a strict host CSP this needs exactly ONE directive:
//
//      frame-src <hostedOrigin>        (or `child-src`, its older spelling)
//
// and nothing else:
//
//   - No `style-src 'unsafe-inline'`. Every style here is assigned through
//     the CSSOM (`iframe.style.height = …`), which CSP does not govern. There
//     is no `style=""` attribute and no injected `<style>` element, and
//     `test/form-embed.test.ts` asserts both so it cannot regress silently.
//   - No `script-src 'unsafe-inline'`. Nothing is evaluated; the only script
//     is the file you loaded, under whatever `script-src` already admits it.
//   - No `connect-src`. This file makes no request. The page inside the frame
//     makes its own, under the console host's policy, not yours.
//
// ── When the frame never speaks ───────────────────────────────────────────
//
// Rule 3 is silent by design and rule 4 is a set of obligations on somebody
// else's server. Between them sits the failure a merchant actually hits: the
// frame never loads at all. A typo in `hostedOrigin`, `X-Frame-Options:
// SAMEORIGIN` on the route, a console that is down — the three are
// indistinguishable from this side, and none of them is observable. A
// refused frame fires no `onerror`; `onload` DOES fire, for the browser's own
// error document; and reading into the frame to check is precisely what the
// same-origin policy forbids. The only fact available is a negative one:
// nothing valid arrived. `EMBED_UNREACHABLE_TIMEOUT_MS` after the append,
// `options.onUnreachable` reports exactly that and nothing more — it removes
// nothing, resizes nothing, and a frame that turns up late still resizes
// normally.
//
// DEFAULT: nothing at all. No console line, for the same reason rule 3 gives,
// and no timer is scheduled for a caller who did not ask. What to do about an
// unreachable console — a fallback block, a `mailto:`, their own error
// reporting — is the merchant's call; this file only tells them.
//
// The `<script>`-tag path below does NOT expose it, and that is a gap rather
// than a decision that is finished: a `data-` attribute can only carry the
// NAME of a global function, and resolving a string off `window` to call it
// is the shape of API this bundle's CSP claim exists to avoid. A script-tag
// integrator who needs the signal includes the file for its
// `window.DhaamFormEmbed` API and calls `embed()` themselves, which is
// already a supported way to use it.
//
// ── Nothing here is allowed to break the host page ────────────────────────
//
// Same contract as `embed.ts`: the script-tag boot at the bottom is wrapped,
// and its failure path is one `console.error`. `embedForm` itself DOES throw
// on a bad call — a missing origin, a secret key — because a thrown error at
// the call site is the right outcome for a developer's mistake, and the
// script-tag path catches it before it can reach the merchant's page load.

/** The `type` of the one message the frame posts. */
export const FORM_RESIZE_MESSAGE_TYPE = 'dhaam-form:resize';

/**
 * The iframe's height until the page inside says otherwise.
 *
 * Tall enough that the form's heading and first field are visible while the
 * page loads — a near-zero frame reads as "nothing here" — and bounded, so a
 * page that never speaks (blocked, offline, an old console) leaves a box and
 * not a void.
 *
 * A starting value and not a floor. It is also, because `scrolling="no"` and
 * `overflow: hidden` are set unconditionally below, the size at which a page
 * that never posts a height is CLIPPED — with no scrollbar, and so with no
 * reachable submit button on any form taller than this. Rule 4(c) puts the
 * obligation to avoid that where it belongs, on the hosted page;
 * `EMBED_UNREACHABLE_TIMEOUT_MS` reports it when it happens anyway.
 */
export const EMBED_MIN_HEIGHT_PX = 320;

/**
 * How long the frame has to say ANYTHING before `onUnreachable` fires.
 *
 * Ten seconds, chosen from the two failures it sits between. Too short and a
 * hosted page that is merely slow — a cold serverless start on a phone on
 * 3G — fires a merchant's fallback over a form that was about to appear, and
 * a false positive here is worse than the silence it replaces. Too long and
 * it is not a diagnostic, because whoever pasted the wrong `hostedOrigin` has
 * already gone to look somewhere else.
 *
 * It is a REPORTING deadline and nothing else: it never removes the frame,
 * never changes its height and never cancels anything. A page that loads on
 * the eleventh second still resizes normally — rule 3 keeps listening — it
 * just does so after the callback has already said it had not arrived.
 */
export const EMBED_UNREACHABLE_TIMEOUT_MS = 10_000;

export interface EmbedFormOptions {
  /** `dhp_…`. Goes into the iframe URL, which is why a secret key is refused. */
  readonly publishableKey: string;
  /** The console host, as an origin: `https://console.example.com`. Required. */
  readonly hostedOrigin: string;
  /** The iframe's accessible name. Default `'Contact form'`. */
  readonly title?: string;
  /** Tears the embed down when aborted. Honoured whether already aborted or live. */
  readonly signal?: AbortSignal;
  /**
   * Called ONCE if no valid height arrives within `EMBED_UNREACHABLE_TIMEOUT_MS`.
   *
   * The only observable this surface has for its most likely production
   * failure — a typo'd `hostedOrigin`, a hosted page behind
   * `X-Frame-Options: SAMEORIGIN` (rule 4(a)), a console that is down. Rule 3
   * is silent by design and the frame is cross-origin, so without this there
   * is no signal anywhere: `iframe.onerror` does not fire for a refused frame,
   * `onload` fires for the browser's own error document, and reading into the
   * frame to check is exactly what the same-origin policy forbids.
   *
   * DEFAULT: nothing. No console line, no timer, no fallback — for the reason
   * rule 3 gives about a shared `message` channel, and because this cannot
   * distinguish "broken" from "slow" well enough to be right on someone
   * else's page without their say-so. Render your own fallback here, or a
   * `mailto:` link, or report it; that call belongs to the merchant.
   *
   * Not fired for an embed that was destroyed or whose `signal` aborted: the
   * caller already knows where that frame went.
   */
  readonly onUnreachable?: () => void;
}

export interface EmbedHandle {
  /** The single element added to the host document. */
  readonly iframe: HTMLIFrameElement;
  /** Removes the iframe and the `message` listener. Idempotent. */
  destroy(): void;
}

/** Refused for a reason that names no input. */
export class FormEmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormEmbedError';
  }
}

/**
 * Whether `value` is a canonical `http:`/`https:` origin.
 *
 * Canonical — `new URL(value).origin === value` — because an origin that is
 * compared by string equality has to be in the one form the browser will
 * report it in. `form.ts` carries the same test for its `parentOrigin` rather
 * than importing this one, because an import in either direction would put
 * this file's code into `dist/form.js` or vice versa.
 *
 * ── Why the scheme test, which `form.ts`'s copy does not have ─────────────
 *
 * `ws://`, `wss://` and `ftp://` all satisfy the canonical test — they ARE
 * canonical origins — and none of them is something an `<iframe>` can load.
 * Accepted, they produce the worst failure this surface has: the frame never
 * navigates, so it never posts a height, so the box sits at
 * `EMBED_MIN_HEIGHT_PX` and empty, and rule 3's silence guarantees nothing
 * anywhere says why. A typo'd scheme is a call-site mistake and belongs in
 * the throw with the rest of them.
 *
 * The two copies differ legitimately: this value is a URL the browser must
 * NAVIGATE to, while `form.ts`'s is a `postMessage` TARGET that the browser
 * itself matches against the real parent origin.
 */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch {
    return false;
  }
}

/**
 * Whether `value` is a SECRET key, by the same three prefixes core refuses.
 *
 * A local copy, for the reason the header gives — importing `auth.ts` would
 * pull `@dhaam-ccrm/core` into a bundle whose whole claim is that it contains
 * none of it. `test/form-embed.test.ts` pins this function to core's own
 * answer over every prefix, so a rename that reaches core and not this line is
 * a failing test rather than a leaked credential.
 *
 * Trimmed and lowercased like core's, deliberately over-detecting: a guard
 * that a stray space or a capital letter steps around is not a guard, and
 * over-detecting costs a developer one clear error where under-detecting costs
 * a secret key written into a URL.
 */
function looksLikeSecretKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ['dhk_', 'dhsk_', 'sk_'].some((prefix) => normalized.startsWith(prefix));
}

/**
 * Every publishable-key prefix anything in this system accepts today.
 *
 * `dhp_` is current (`packages/core/src/auth/keys.ts`). `dhpk_` is the retired
 * spelling, still accepted by core for the deprecation window and still the
 * one chat-service-node's customer auth middleware documents on the wire
 * (`src/api/rest/middleware/customer-auth.middleware.ts`, X-Publishable-Key:
 * dhpk_live_… / dhpk_test_…). Both are in the wild; recognising only one of
 * them would warn a whole population of correct integrations.
 */
const PUBLISHABLE_PREFIXES = ['dhp_live_', 'dhp_test_', 'dhpk_live_', 'dhpk_test_'] as const;

/**
 * Whether this module instance has already printed the prefix warning.
 *
 * Module state, which is to say once per page load: a merchant with a contact
 * block and a footer embed, or one script tag over three `[data-dhaam-form]`
 * slots, has made ONE mistake and should read ONE line about it. Repeated
 * identical console output is precisely how an integrator learns to filter our
 * prefix out of their console — the same argument `onMessage` below makes for
 * ignoring foreign traffic silently — and the next warning we print is the one
 * that pays for it.
 *
 * Deliberately NOT per-key: five embeds of five different unrecognised keys is
 * one fact about one integration, not five.
 */
let warnedAboutPrefix = false;

/**
 * Warns, ONCE, about a key that matches no publishable prefix we know.
 *
 * Advisory and never a throw, which is the asymmetry that matters. A secret
 * key is a credential incident and stops the embed; an UNRECOGNISED prefix is
 * just a prefix this bundle has not been taught. Publishable keys are baked
 * into pages that ship to every visitor and cannot be redeployed on our
 * schedule, and the server — not this file — is the authority on what it will
 * accept. Refusing here would take a merchant's contact form off the air over
 * a format list that has already been renamed twice; the hosted page answers
 * for the key either way, and — given the hosted page obeys the height
 * requirement in rule 4(c) — its 401 is a visible, recoverable failure.
 */
function warnUnlessPublishable(value: string): void {
  const normalized = value.trim().toLowerCase();
  if (PUBLISHABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return;
  if (warnedAboutPrefix) return;
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
  // Set BEFORE the call, not after: `console.warn` is replaceable, and a host
  // page whose logger throws must not turn one advisory line into one throw
  // per embed on every subsequent mount.
  warnedAboutPrefix = true;
  // The field and the expected prefixes, never the value: this line runs on
  // a credential and must not be the thing that prints one into a shared
  // browser console.
  console.warn(
    '[@dhaam-ccrm/widget] embedForm: publishableKey does not start with dhp_live_ or dhp_test_ — ' +
      'embedding anyway; the hosted page is the authority on the key.',
  );
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    // The field NAME, never the value: this guards `publishableKey`, so
    // echoing the input is the credential leak it exists to close.
    throw new FormEmbedError(`${field} is required`);
  }
  return value.trim();
}

/**
 * Embeds the hosted web form in an `<iframe>` appended to `target`.
 *
 * APPENDS and never clears `target`, for the reason `ui/form-root.ts` gives:
 * a merchant's "or email us at…" fallback inside that element is theirs.
 *
 * `destroy()` removes the iframe and the `message` listener. Idempotent. An
 * `options.signal` does the same when it aborts; one that is ALREADY aborted
 * returns a handle whose iframe never entered the document — a route
 * component unmounted before its effect settled is the ordinary case here.
 */
export function embedForm(target: Element, options: EmbedFormOptions): EmbedHandle {
  // Checked rather than assumed: the realistic caller is a framework ref that
  // has not attached yet — `null`, not a typo — and the failure should point
  // at the call, not at `appendChild` three frames down.
  if (target === null || typeof target !== 'object' || typeof target.appendChild !== 'function') {
    throw new FormEmbedError('embedForm() needs an element to embed into');
  }
  if (options === null || typeof options !== 'object') {
    throw new FormEmbedError('embedForm() needs a publishableKey and a hostedOrigin');
  }

  const publishableKey = requireString(options.publishableKey, 'publishableKey');
  if (looksLikeSecretKey(publishableKey)) {
    // Thrown, not reported: this key is about to be written into a URL on a
    // page any visitor can read — and a URL ends up in the frame's Referer,
    // in the merchant's access logs and in browser history. It must stop the
    // embed. The message names the mistake and never the value.
    throw new FormEmbedError('a secret key was passed to embedForm; use the publishable key');
  }
  warnUnlessPublishable(publishableKey);
  const hostedOrigin = requireString(options.hostedOrigin, 'hostedOrigin');
  if (!isOrigin(hostedOrigin)) {
    throw new FormEmbedError(
      'hostedOrigin must be an http(s) origin — scheme://host[:port] with no path and no trailing slash',
    );
  }

  const iframe = document.createElement('iframe');
  iframe.title = options.title ?? 'Contact form';
  // The attribute is the only cross-browser switch for the frame's OWN
  // scrollbar; `overflow` on the element covers the CSS side. Together with
  // the height protocol, the frame never scrolls inside itself.
  iframe.setAttribute('scrolling', 'no');
  // CSSOM property assignment ONLY — never `setAttribute('style', …)` and
  // never a `<style>` element — so a strict `style-src` never sees us.
  iframe.style.width = '100%';
  iframe.style.height = `${EMBED_MIN_HEIGHT_PX}px`;
  iframe.style.border = '0';
  iframe.style.overflow = 'hidden';
  // Block, not the default inline: an inline iframe sits on the text baseline
  // and leaves a few pixels of gap beneath it, which is the classic "why does
  // my container scroll by 4px" that this surface exists to avoid.
  iframe.style.display = 'block';
  // Set BEFORE the append so the frame navigates exactly once, and so an
  // already-aborted caller's iframe — never appended — never navigates at all.
  iframe.src =
    `${hostedOrigin}/f/${encodeURIComponent(publishableKey)}` +
    `?embed=1&origin=${encodeURIComponent(window.location.origin)}`;

  // The reporting deadline of `onUnreachable`, armed at the bottom of this
  // function and disarmed by the first ACCEPTED height or by `destroy`.
  // `ReturnType<typeof setTimeout>` rather than `number`: this file is
  // browser-only, but the package typechecks with node types in scope.
  let unreachableTimer: ReturnType<typeof setTimeout> | null = null;
  const clearUnreachableTimer = (): void => {
    if (unreachableTimer === null) return;
    clearTimeout(unreachableTimer);
    unreachableTimer = null;
  };

  /**
   * The whole of rule 3. All four checks, or the event is ignored SILENTLY.
   *
   * Silence is the design, not an omission. Every `message` event on a page
   * reaches every listener on it, so a merchant running this embed plus a
   * payment frame plus a second copy of this embed sees all of their traffic
   * here — reporting it would print a line per message per embed and teach an
   * integrator to ignore our console output entirely.
   *
   * (a) and (b) are the security half, and neither is sufficient alone. The
   * origin check without the source check accepts ANY document on the console
   * host, including a second embed's frame on this same page, whose height
   * would then be applied to this frame. The source check without the origin
   * check trusts whatever that frame has navigated to, which after a
   * redirect or a hijacked subresource is no longer the page we asked for.
   */
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== hostedOrigin) return;
    // `contentWindow` is read at delivery rather than captured at creation:
    // the frame may have navigated, and the live property is what the
    // platform will have set `source` to.
    if (event.source === null || event.source !== iframe.contentWindow) return;

    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
    const payload = data as { readonly type?: unknown; readonly height?: unknown };
    if (payload.type !== FORM_RESIZE_MESSAGE_TYPE) return;

    const height = payload.height;
    // `typeof` first: `Number.isFinite` is false for a string, but reading it
    // as a number later would resurrect `'742'`, and a payload that arrived
    // as a string is a page we do not recognise rather than one to coerce.
    if (typeof height !== 'number' || !Number.isFinite(height) || height < 0) return;

    // Heard from. Cleared HERE, past all four checks, rather than on any
    // `message` event: a lookalike origin or another product's frame posting
    // into this window is not our page loading, and letting it cancel the
    // signal would hand an unrelated script on the merchant's page the power
    // to suppress the one diagnostic this surface has.
    clearUnreachableTimer();

    // UP, never down. A fraction rounded down is a frame one pixel short of
    // its content, which is exactly the scrollbar this protocol exists to
    // remove. Applied as given otherwise — EMBED_MIN_HEIGHT_PX is a starting
    // value, not a floor, because the submitted form is a two-line
    // confirmation and clamping would leave 200px of empty frame under it.
    iframe.style.height = `${Math.ceil(height)}px`;
  };

  const signal = options.signal;
  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    // Released rather than merely guarded: a listener left on the window
    // holds this closure, and the detached iframe inside it, for the life of
    // a page that may mount and unmount this embed many times.
    window.removeEventListener('message', onMessage);
    signal?.removeEventListener('abort', destroy);
    clearUnreachableTimer();
    iframe.remove();
  };

  // Read as a STATE as well as subscribed to as an event: a signal that
  // aborted before this line fires no event for the listener below to hear.
  if (signal?.aborted === true) {
    destroyed = true;
    return { iframe, destroy };
  }
  signal?.addEventListener('abort', destroy, { once: true });

  // Installed BEFORE the append, so a frame that loads and reports its height
  // immediately cannot beat its own listener onto the page.
  window.addEventListener('message', onMessage);
  target.appendChild(iframe);

  // Armed only for a caller who asked. `typeof`, not `!== undefined`: a
  // caller who passes something that is not callable gets nothing rather than
  // a `TypeError` thrown ten seconds later from a timer, on a page where
  // nothing is left to catch it.
  const onUnreachable = options.onUnreachable;
  if (typeof onUnreachable === 'function') {
    unreachableTimer = setTimeout(() => {
      // Cleared BEFORE the call, so the handle is consistent if the
      // merchant's callback throws — it is their code, and their error
      // belongs in their tracker rather than swallowed here.
      unreachableTimer = null;
      onUnreachable();
    }, EMBED_UNREACHABLE_TIMEOUT_MS);
  }
  return { iframe, destroy };
}

// ── The `<script src="…/form-embed.js">` half ──────────────────────────────
//
// Bundled by `scripts/bundle.mjs`, which supplies a two-line entry calling
// `installFormEmbedGlobal()`. The entry lives in the build script rather than
// in `src/` for the reason `form.ts` gives about its own: auto-installing a
// global and scanning the document are properties of THAT ARTIFACT, and a
// React app importing `embedForm` from the npm package must get neither.
//
//     <script src="https://cdn.dhaamai.com/form-embed.js"
//             data-publishable-key="dhp_live_…"
//             data-hosted-origin="https://console.dhaamdesk.com"></script>
//     <div data-dhaam-form></div>
//
// Two different origins, and mixing them up is the mistake this comment
// exists to prevent: the SCRIPT comes from the SDK's CDN, and
// `data-hosted-origin` is the CONSOLE host that serves `/f/<publishableKey>`.
// There is no default for the second one — this package has no canonical
// console origin to bake in — so a tag without it installs the API and
// embeds nothing.

/** The API a `<script>`-tag integrator gets, on `window.DhaamFormEmbed`. */
export interface DhaamFormEmbedGlobal {
  embed(target: Element, options: EmbedFormOptions): EmbedHandle;
}

function reportBootFailure(error: unknown): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    // The error object, never a config value. `FormEmbedError` is thrown for
    // a pasted secret key, and this line must not be the thing that prints it
    // into a shared browser console — its message names the field, never the
    // value, for exactly this reason.
    console.error('[@dhaam-ccrm/widget] form embed failed to start', error);
  }
}

/**
 * The tag that loaded us.
 *
 * `document.currentScript` is correct only while the script evaluates
 * synchronously and is `null` for a module script or one appended by a
 * loader. The fallback finds our tag by its marker attributes rather than by
 * `src`: a CDN, a proxy or a tag manager will each rewrite the URL, so a
 * `src.includes('form-embed.js')` test would find nothing.
 */
function locateScript(): HTMLElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLElement) return current;
  return document.querySelector<HTMLElement>('script[data-publishable-key][data-hosted-origin]');
}

/**
 * Embeds the hosted form into every element the script tag points at.
 *
 * One selector, defaulting to `[data-dhaam-form]` — the same marker
 * `form.js` uses, so a merchant migrating from the inline embed to the iframe
 * one swaps the script tag and changes nothing else in their markup.
 *
 * A tag with no `data-hosted-origin`, or with `data-auto="false"`, embeds
 * nothing and says nothing: including this file for the
 * `window.DhaamFormEmbed` API and embedding by hand is a legitimate way to
 * use it, and warning about it would train integrators to ignore our output.
 */
export function bootEmbedsFromDocument(): void {
  const script = locateScript();
  if (script === null) return;
  if (script.dataset['auto'] === 'false') return;

  const publishableKey = script.dataset['publishableKey'];
  const hostedOrigin = script.dataset['hostedOrigin'];
  if (publishableKey === undefined || publishableKey === '') return;
  if (hostedOrigin === undefined || hostedOrigin === '') return;

  const title = script.dataset['title'];
  const selector = script.dataset['target'] ?? '[data-dhaam-form]';
  for (const target of document.querySelectorAll(selector)) {
    try {
      embedForm(target, {
        publishableKey,
        hostedOrigin,
        ...(title === undefined ? {} : { title }),
      });
    } catch (error) {
      // One bad target must not stop the rest, and nothing here may reach the
      // host page as an exception — this file evaluates inside someone's
      // contact page and an escape lands in THEIR error tracker as a defect
      // in THEIR product.
      reportBootFailure(error);
    }
  }
}

/**
 * Installs `window.DhaamFormEmbed` and boots once the document has a body.
 *
 * Not overwritten if present: a second copy of this bundle must not swap out
 * an API object the host may already hold a reference to.
 */
export function installFormEmbedGlobal(): void {
  try {
    const api: DhaamFormEmbedGlobal = { embed: embedForm };
    const target = window as unknown as Record<string, unknown>;
    target['DhaamFormEmbed'] ??= api;

    const run = (): void => {
      try {
        bootEmbedsFromDocument();
      } catch (error) {
        reportBootFailure(error);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  } catch (error) {
    reportBootFailure(error);
  }
}
