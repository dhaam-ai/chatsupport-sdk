// `mountForm` — the web form, standalone.
//
// No launcher, no panel, no socket, no session, no token mint. One element of
// ours enters the host document, it goes where the CALLER said, and the only
// credential involved is the publishable key, which authenticates nothing on
// its own (§10.1) and is why this file can be served from a CDN at all.
//
// Three delivery surfaces sit on top of this: an inline embed, an iframe
// embed, and a mountable route component. They differ in where the element
// comes from, not in what is rendered into it, so all three call this.
//
// ── The form itself is NOT built here ────────────────────────────────────
//
// `ui/webform-form.ts` builds it, unchanged and unparameterised, and this
// module supplies the element to put it in, the stylesheet, the submit
// function and the one degraded state that surface has no equivalent of.
// Reusing it rather than writing a second form is the whole point: the
// honeypot, the fill-time signal, the per-instance idempotency key, the
// required-field messages, the focus handling on submit and the typed error
// mapping are all things a second implementation would get subtly wrong, and
// the two forms would then disagree about what the same tenant's submission
// means.
//
// ── The failure a visitor sees, and the two renders it forces ───────────
//
// A blank rectangle on a merchant's contact page is the outcome designed
// against, so the form renders SYNCHRONOUSLY and unconditionally. Nothing is
// awaited before first paint and no upstream answer can produce an empty
// element. The boot read runs alongside and can only ADD to the form, never
// withhold it.
//
// That is also why the tenant's own shape arrives in a SECOND render. Both
// things `GET /widget/form` publishes about a tenant — `contactRequirement`,
// which decides whether Email or Phone is the detail the submit route will
// insist on, and `form.title` / `form.intro` / `form.successMessage`, the
// merchant's own copy — are answers to a network call, and the first paint
// happens before that call lands. `ui/webform-form.ts` takes both as options
// and builds a form in one shot, so the only way to apply them is to build a
// second one. `applyTenantShape` below does exactly that, and only when the
// answer would change something on screen: for the common tenant — the
// server's default rule, no copy — the first render IS the tenant's render
// and nothing is rebuilt. What the visitor already typed crosses over; see
// that function.
//
// Both were parsed here and thrown away for one release. The merchant could
// configure the rule, the server enforced it on submit, and every visitor saw
// the `'email'` form regardless — which is why
// `test/webform-tenant-wiring.test.ts` asserts on rendered labels and
// rendered text rather than on the options object.

import { createFormRoot } from './ui/form-root.js';
import { FORM_STYLES } from './ui/form-styles.js';
import { DEFAULT_CONTACT_REQUIREMENT, createWebformForm } from './ui/webform-form.js';
import type { WebformView } from './ui/webform-form.js';
import { el } from './ui/dom.js';
import { WebformError, submitWebform, visitorMessage } from './webform.js';
import type { ContactRequirement, WebformCopy, WebformDraft, WebformReceipt } from './webform.js';

/** Path is fixed by chat-service; only the origin is the host's to state. */
export const FORM_BOOT_PATH = '/chat-services/api/v1/widget/form';

/**
 * Short, and deliberately shorter than the submit's 15 s.
 *
 * Nothing renders behind this wait — the form is already on screen — so the
 * only thing a longer timeout buys is a later chance to disable a submit
 * button, and the only thing it costs is a `fetch` and an `AbortController`
 * held open on someone else's page. Same 2 s as `remote-config.ts`'s read,
 * for the same reason.
 */
export const FORM_BOOT_TIMEOUT_MS = 2_000;

/**
 * The tenant's own copy, when they wrote any. `null` when they did not.
 *
 * An ALIAS, not a second declaration. This was a structurally identical
 * interface of its own, and two shapes describing one wire block is one shape
 * too many: `webform.ts`'s is what `createWebformForm` takes, so a field added
 * to one and not the other would have compiled here and rendered nothing.
 * The name stays because it is what this module's `FormBoot` is documented and
 * exported under.
 */
export type FormCopy = WebformCopy;

/**
 * Which contact detail the SUBMIT route will insist on for this tenant.
 *
 * Re-exported from `webform.ts` rather than redeclared, for the reason
 * {@link FormCopy} gives. The union is byte-identical either way — this is a
 * change of where the type LIVES, not of what it is.
 */
export type { ContactRequirement };

/** Per-field caps, as published. UTF-16 code units, not bytes. */
export interface FormFieldLimits {
  readonly name?: number;
  readonly email?: number;
  readonly phone?: number;
  readonly subject?: number;
  readonly message?: number;
}

/**
 * The boot read's three outcomes, collapsed to what a caller can act on.
 *
 * `'refused'` means THE SUBMIT WILL ALSO BE REFUSED, for the same reason and
 * by the same control. Only two statuses qualify and both are checked against
 * the route's source rather than its summary:
 *
 *   401 — the developer's own bad key. One byte-identical body for all six
 *         credential failure modes, so there is nothing to read but the
 *         status; the submit route resolves the tenant from the same key.
 *   403 — `ORIGIN_NOT_ALLOWED`, from `tenants.allowed_origins`. The submit
 *         route reads the SAME list through the same
 *         `getAllowedOrigins(tenantId)` and refuses the same origins.
 *
 * Everything else is `'unknown'` and changes nothing on screen. A 404 in
 * particular MUST NOT block: the whole route is behind
 * `WEBFORM_ENDPOINT_ENABLED` and is not mounted at all when that is unset, so
 * every chat-service deployed before this route existed answers 404 while its
 * submit route works perfectly. Treating that as a refusal would ship a form
 * that is dead everywhere until the server catches up.
 */
export type FormBoot =
  | {
      readonly kind: 'ok';
      readonly contactRequirement: ContactRequirement;
      readonly limits: FormFieldLimits;
      /** Absent on the wire ⇒ `null` here ⇒ render your own strings. */
      readonly form: FormCopy | null;
    }
  | { readonly kind: 'refused'; readonly status: number; readonly code: string | undefined; readonly requestId: string | undefined }
  | { readonly kind: 'unknown' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseCopy(value: unknown): FormCopy | null {
  if (!isRecord(value)) return null;
  return {
    title: optionalString(value['title']),
    intro: optionalString(value['intro']),
    successMessage: optionalString(value['successMessage']),
  };
}

function parseLimits(value: unknown): FormFieldLimits {
  if (!isRecord(value)) return {};
  const limits: Record<string, number> = {};
  for (const key of ['name', 'email', 'phone', 'subject', 'message'] as const) {
    const cap = optionalNumber(value[key]);
    if (cap !== undefined) limits[key] = cap;
  }
  return limits;
}

function parseContactRequirement(value: unknown): ContactRequirement {
  // The column's own NOT NULL DEFAULT, and what the submit route falls back
  // to for a tenant with no row. An unknown string is that same default
  // rather than a guess, so a value a newer server adds degrades to the
  // loosest rule this form can satisfy instead of demanding a field nobody
  // asked for.
  //
  // THE SHARED CONSTANT, not a second `'either'` spelled here. This value and
  // the one `createWebformForm` applies when a caller names nothing are the
  // same fallback reached by two routes — the first render uses that one, this
  // one answers the boot read — and if the two ever disagreed, an unreadable
  // tenant would get a form that visibly changed shape a moment after it
  // appeared, for no reason a visitor could see. Equal by construction now.
  return value === 'email' || value === 'phone' ? value : DEFAULT_CONTACT_REQUIREMENT;
}

export interface ReadFormBootOptions {
  readonly apiUrl: string;
  readonly publishableKey: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * Reads `GET /chat-services/api/v1/widget/form`.
 *
 * THE SINGLE POINT OF CONTACT with that route. It is in review and its
 * contract is provisional, so everything this bundle knows about it — the
 * path, the header, the envelope, which statuses are fatal, where the copy
 * sits — is in this one function and the types above it. A contract change is
 * an edit here and nowhere else.
 *
 * Never throws and never rejects. Every failure class collapses to a verdict,
 * because the caller already has a form on screen and the only question left
 * is whether to let the visitor press Send.
 *
 * ── The response shape, read off the handler and not off a summary ───────
 *
 *   200 { success: true, data: { contactRequirement, limits, form? } }
 *
 * The `{ success, data }` envelope is load-bearing and is easy to miss: the
 * three fields are NOT at the top level. `form` is SPREAD in, so the key is
 * absent rather than null when the tenant wrote no copy, has no config row,
 * had it switched off, or when nexusai was unreachable — four different
 * upstream states, one wire shape, one reading: render your own strings.
 *
 * `cache: 'default'` rather than `'no-store'`. The route serves
 * `Cache-Control: public, max-age=30, stale-while-revalidate=300` with
 * `Vary: X-Publishable-Key`, and the browser's HTTP cache is the intended
 * consumer of it — freshness and revalidation are left to it rather than
 * driven by hand, which is both cheaper and correct.
 *
 * There is deliberately no 304 branch below, and `ETag` being on the route's
 * `exposedHeaders` is not what decides that. `Access-Control-Expose-Headers`
 * governs what JAVASCRIPT may read off the response; the HTTP cache
 * revalidates underneath that filter and needs no such grant. And with
 * `cache: 'default'` and no hand-set `If-None-Match`, a successful
 * revalidation is spent by the cache and reaches this function as the stored
 * 200 — not as a 304. If one ever did surface it would fall into the
 * `!response.ok` line and degrade to `unknown`, which leaves the form usable:
 * the safe direction for a status this code has no reading of.
 */
export async function readFormBoot(options: ReadFormBootOptions): Promise<FormBoot> {
  const { apiUrl, publishableKey, signal, timeoutMs = FORM_BOOT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  // Read as a STATE as well as subscribed to as an event. A signal that
  // aborted before this line fires no event for the listener above to hear,
  // and the request would go out for a caller that is already gone — bounded
  // by the timeout, so a wasted request rather than a hang, but this function
  // is exported precisely for route components, and "unmounted before the
  // effect settled" is their ordinary case, not their edge case.
  if (signal?.aborted === true) controller.abort();

  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}${FORM_BOOT_PATH}`, {
      method: 'GET',
      // The key goes in a HEADER rather than the query string, which is what
      // keeps it out of access logs, Referer headers and browser history —
      // and what makes this a preflighted request rather than a simple one.
      headers: { Accept: 'application/json', 'X-Publishable-Key': publishableKey },
      // No cookies. A public read that authenticates itself has no use for
      // the merchant's session and would only add a CSRF surface.
      credentials: 'omit',
      cache: 'default',
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const error = isRecord(body) ? body['error'] : null;
      const code = isRecord(error) ? optionalString(error['code']) ?? undefined : undefined;
      return {
        kind: 'refused',
        status: response.status,
        code,
        // Exposed by the route's CORS options precisely so an embedding
        // developer has one id to quote. Absent means the browser withheld
        // it, not that the server omitted it.
        requestId: response.headers.get('X-Request-ID') ?? undefined,
      };
    }

    if (!response.ok) return { kind: 'unknown' };

    const body: unknown = await response.json();
    const data = isRecord(body) ? body['data'] : null;
    if (!isRecord(data)) return { kind: 'unknown' };

    return {
      kind: 'ok',
      contactRequirement: parseContactRequirement(data['contactRequirement']),
      limits: parseLimits(data['limits']),
      form: parseCopy(data['form']),
    };
  } catch {
    // Includes the CORS case, which surfaces as a bare TypeError: the browser
    // refuses to say why a cross-origin read failed, so there is nothing here
    // to tell "fleet origin policy" apart from "server down". Neither is a
    // reason to take the form away.
    return { kind: 'unknown' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

export interface MountFormOptions {
  /** Origin of chat-service. No trailing slash required. */
  readonly apiUrl: string;
  /** `dhp_…`. The only credential this form has or needs. */
  readonly publishableKey: string;
  /** Diagnostics for the DEVELOPER. Never shown to the visitor. */
  readonly onError?: (error: unknown) => void;
  /** Fired once, after an accepted submission. */
  readonly onSubmitted?: (receipt: WebformReceipt) => void;
  /**
   * The EMBEDDER's origin, when this form is rendered inside an iframe.
   *
   * Set ONLY by the hosted page (`GET /f/<publishableKey>?embed=1&origin=…`),
   * which reads it with `parentOriginFromLocation(location.search)` below.
   * Given it, the form reports its height upward on every size change so the
   * frame around it never shows a scrollbar of its own — see the protocol
   * block in `src/form-embed.ts`, which is the host half of the same
   * contract and the thing a hosted page is built against.
   *
   * Absent, nothing is posted and nothing is observed: the inline embed and
   * the route component are unchanged by this option existing.
   *
   * A value that is not a canonical origin is IGNORED and nothing is ever
   * posted — never a fallback to `'*'`, which would hand the form's
   * dimensions to whatever document happens to be framing the page.
   *
   * Typed `| undefined` deliberately, under `exactOptionalPropertyTypes`, so
   * that `{ parentOrigin: parentOriginFromLocation(location.search) }` — the
   * one line the hosted page exists to write — type-checks.
   */
  readonly parentOrigin?: string | undefined;
}

export interface MountedForm {
  /** The single element added to the host document. */
  readonly host: HTMLElement;
  /** Open, so an accessibility audit on the merchant's page can walk it. */
  readonly shadow: ShadowRoot;
  /** Moves keyboard focus into the form. */
  focus(): void;
  /** Removes the form and aborts the boot read. Idempotent. */
  destroy(): void;
}

/**
 * Mounted forms, by the element they were mounted into.
 *
 * Keyed PER ELEMENT rather than per page, unlike `singleton.ts`'s one-widget
 * guard. A page with two forms is a real thing — a contact block in the body
 * and another in the footer — and a per-page guard would also make the three
 * surfaces above this one mutually exclusive, so an inline embed and a
 * route component could not coexist during a migration. What a per-element
 * map does prevent is the case that actually happens: the same element
 * mounted twice by a framework that ran an effect twice, which without this
 * renders two forms, two honeypots and two idempotency keys in one container.
 *
 * `WeakMap`, so an element removed from the document by the host takes its
 * entry with it rather than pinning it for the life of the page.
 */
const mounted = new WeakMap<Element, MountedForm>();

/**
 * What the announcer says when the tenant's answer moved the contact rule.
 *
 * Names the change rather than reporting that one happened: "the form was
 * updated" tells a screen-reader user that something they cannot see is now
 * different and leaves them to find it. Each sentence is the rule the form
 * now carries, in the same words the form itself uses for it — the `'either'`
 * line is `ui/webform-form.ts`'s own hint, minus its trailing clause.
 */
const RESHAPE_NOTICE: Record<ContactRequirement, string> = {
  email: 'This form was updated: an email address is now required.',
  phone: 'This form was updated: a phone number is now required.',
  either: 'This form was updated: enter an email address or a phone number.',
};

/** The other rebuild: the rule did not move, the merchant's own copy arrived.
 *  Nothing about what to fill in changed, so nothing is claimed about it. */
const COPY_NOTICE = 'This form was updated.';

function report(onError: ((error: unknown) => void) | undefined, error: unknown): void {
  if (onError !== undefined) {
    onError(error);
    return;
  }
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    // The error, never a config value: `FormConfigError` below is thrown for
    // a pasted secret key and this line must not be what prints it into a
    // shared browser console. Its message names the FIELD, never the value.
    console.warn('[@dhaam-ccrm/widget] form', error);
  }
}

/** Refused for a reason that names no input. */
export class FormConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormConfigError';
  }
}

/**
 * Whether `value` is a SECRET key rather than a publishable one.
 *
 * ── A local predicate, and why it is not `auth.ts`'s ──────────────────────
 *
 * `auth.ts` asks `@dhaam-ccrm/core`'s parser, which is the right authority
 * and is what the widget uses. Importing it here would pull core into
 * `dist/form.js`, whose entire reason to exist is being small enough to drop
 * onto a contact page — core alone is the majority of `dist/widget.js`.
 *
 * A second prefix list is exactly the drift `auth.ts`'s header warns about
 * (the prefixes have already been renamed twice), so the drift is made LOUD
 * rather than merely unlikely: `test/mount-form.test.ts` asserts this
 * function agrees with `looksLikeSecretKey` — core's own answer — on every
 * prefix. A rename that reaches core and not this list is a failing test, not
 * a leaked credential.
 */
export function looksLikeSecretKeyLocal(value: string): boolean {
  return /^(dhk_|dhsk_|sk_)/.test(value.trim());
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    // The field NAME, never the value: this guards `publishableKey` among
    // others, so echoing the input is the credential leak it exists to close.
    throw new FormConfigError(`${field} is required`);
  }
  return value.trim();
}

// ── The iframe embed's frame half ─────────────────────────────────────────
//
// The host half is `src/form-embed.ts`, and its header holds the protocol
// both sides are written against. Nothing is imported across that boundary in
// either direction: `dist/form.js` must not carry the embed's script-tag
// code, and `dist/form-embed.js` must not carry this form. The two things
// they would otherwise share are a message name and an origin test, and both
// are pinned by test rather than by an import — `test/mount-form.test.ts`
// asserts what this posts against the constant the HOST side exports, so a
// rename on one side is a failing test rather than a form that silently
// stops resizing.

/** Frame → host. Must equal `form-embed.ts`'s `FORM_RESIZE_MESSAGE_TYPE`. */
const RESIZE_MESSAGE_TYPE = 'dhaam-form:resize';

/**
 * Whether `value` is a canonical origin — `new URL(value).origin === value`.
 *
 * Canonical is what matters: `https://shop.example.com/` and
 * `https://shop.example.com:443` both denote the right origin and neither is
 * what `postMessage` will compare against, so both are refused here rather
 * than silently repaired into something that never matches.
 *
 * ── NOT the same test as `form-embed.ts`'s, and deliberately ─────────────
 *
 * That copy is four lines: it ALSO requires `http:` or `https:`. The two
 * diverge because the two values are used for different things, and the
 * justification lives with the stricter one — see `form-embed.ts`'s `isOrigin`
 * for the full argument. In short: that value is a URL the browser must
 * NAVIGATE to, and `ws://`/`wss://`/`ftp://` are all canonical origins that no
 * `<iframe>` can load, so accepting one there produces a frame that never
 * posts a height and a box that sits empty with nothing anywhere saying why.
 * THIS value is a `postMessage` TARGET, which the browser itself matches
 * against the real parent origin — a scheme no parent can have simply never
 * matches, and the message is not sent. There is no silent-empty failure to
 * guard against here, so there is no scheme test.
 *
 * Still a copy rather than an import: an import in either direction would put
 * one of these two files' code into the other's bundle.
 */
function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/**
 * The embedder's origin out of a hosted page's query string, validated.
 *
 * The whole of what `GET /f/<publishableKey>?embed=1&origin=…` has to do to
 * join the protocol:
 *
 *     mountForm(el, { apiUrl, publishableKey, parentOrigin: parentOriginFromLocation(location.search) });
 *
 * `undefined` for anything that is not a canonical origin — absent, empty,
 * `"null"` (what a `file:` or sandboxed embedder reports), a wildcard, or an
 * origin with a path on it. The caller then posts nothing, which is the only
 * safe reading: there is no origin to name, and the alternative a page would
 * otherwise reach for is `'*'`.
 */
export function parentOriginFromLocation(search: string): string | undefined {
  try {
    const value = new URLSearchParams(search).get('origin');
    if (value === null) return undefined;
    return isOrigin(value) ? value : undefined;
  } catch {
    // `URLSearchParams` does not throw on any string, but this runs on the
    // first line of a page inside someone else's frame and is not the place
    // to find out otherwise.
    return undefined;
  }
}

/** Whatever has to be torn down when the form goes away. */
interface ResizeReporter {
  stop(): void;
}

const NO_REPORTER: ResizeReporter = { stop() {} };

/**
 * Reports `host`'s height to `parentOrigin`, now and on every size change.
 *
 * ── Why the HOST ELEMENT and not the document ─────────────────────────────
 *
 * The obvious implementation posts `document.documentElement.scrollHeight`.
 * It is also the one that oscillates: the frame is resized to that height,
 * which changes the layout viewport, which changes the scroll height, which
 * posts again. Observing the element the form is actually in makes the
 * measurement content-driven and independent of the frame it sits in, so a
 * height the host applies cannot feed back into the next measurement. The
 * hosted page therefore gives that element no outside margin — a margin is
 * outside the border box and would simply not be counted.
 *
 * Nothing here may reach the page as an exception. A `postMessage` can throw
 * — a structured-clone failure, a detached parent — and this runs on a
 * merchant's contact form.
 */
function installResizeReporter(host: HTMLElement, parentOrigin: string | undefined): ResizeReporter {
  // Two gates, and the second is the security-relevant one: an origin this
  // function cannot name is an origin it does not post to. There is
  // deliberately no `'*'` path anywhere in this file.
  if (parentOrigin === undefined || !isOrigin(parentOrigin)) return NO_REPORTER;

  let stopped = false;
  const post = (): void => {
    if (stopped) return;
    try {
      const parent = window.parent;
      if (parent === null || typeof parent.postMessage !== 'function') return;
      // Border-box height, taken UP. A fraction rounded down is a frame one
      // pixel short of its content, which is the scrollbar this exists to
      // remove. The host side refuses anything that is not finite and ≥ 0,
      // so a `NaN` from a detached element is dropped here rather than sent
      // and ignored there.
      const height = Math.ceil(host.getBoundingClientRect().height);
      if (!Number.isFinite(height) || height < 0) return;
      parent.postMessage({ type: RESIZE_MESSAGE_TYPE, height }, parentOrigin);
    } catch {
      // Same contract as everything else on this path: a failure to report a
      // height is a frame that does not resize, never an exception in
      // someone else's page.
    }
  };

  // Once, directly, BEFORE any observer. `ResizeObserver` is absent in older
  // Safari and in jsdom, and a form that only reported its height where that
  // API exists would render a 320px letterbox everywhere else.
  post();

  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(post);
    observer.observe(host);
  }

  return {
    stop() {
      stopped = true;
      observer?.disconnect();
      observer = null;
    },
  };
}

/**
 * Mounts the standalone web form into `target`.
 *
 * ── Mount, remount, unmount ──────────────────────────────────────────────
 *
 *   Mounting twice into the SAME element returns the first form and reports
 *   through `onError`. Not an exception: the second call is usually a
 *   framework running an effect twice, not the code anyone is debugging, and
 *   throwing from it would take out whatever else that render was doing.
 *   Loud enough to find, quiet enough not to break a page.
 *
 *   Mounting into a NON-EMPTY element appends and keeps what was there. See
 *   `ui/form-root.ts` for why clearing is the unrecoverable direction.
 *
 *   `destroy()` removes our one element, aborts the boot read, and frees the
 *   element for a later mount. Idempotent. It deliberately does NOT abort an
 *   in-flight SUBMIT: that request may already have been received and
 *   written, and aborting the fetch would not un-send it — it would only
 *   throw away the receipt. The per-form idempotency key is what makes the
 *   visitor's retry safe, and it dies with the form either way.
 */
export function mountForm(target: Element, options: MountFormOptions): MountedForm {
  const onError = options?.onError;

  // Checked rather than assumed, because the realistic caller is a framework
  // handing over a ref that has not attached yet — `null`, not a typo. Without
  // this the failure is a `TypeError` from `appendChild` three frames down,
  // which points at the DOM instead of at the call.
  if (target === null || typeof target !== 'object' || typeof target.appendChild !== 'function') {
    throw new FormConfigError('mountForm() needs an element to mount into');
  }
  if (options === null || typeof options !== 'object') {
    throw new FormConfigError('mountForm() needs an apiUrl and a publishableKey');
  }

  const existing = mounted.get(target);
  if (existing !== undefined) {
    // Still ours only if our element is still IN there. The `WeakMap` is
    // keyed on `target`, so an entry survives anything that removes our
    // `dh-web-form` while leaving `target` standing — `target.innerHTML = ''`,
    // a framework re-render, a host's own cleanup — none of which calls
    // `destroy()`. Returning the entry then hands back a handle whose `host`
    // is detached: it renders nothing, and it reports "already holds a form"
    // about an element that holds none. A silent blank rectangle, which is
    // the one outcome this whole surface exists to avoid.
    if (target.contains(existing.host)) {
      report(onError, new FormConfigError('mountForm() ignored — this element already holds a form'));
      return existing;
    }
    // Through `destroy()` rather than a bare `mounted.delete`, so the orphan's
    // boot read is aborted instead of being left to land on a detached tree.
    existing.destroy();
  }

  const apiUrl = requireString(options.apiUrl, 'apiUrl').replace(/\/+$/, '');
  const publishableKey = requireString(options.publishableKey, 'publishableKey');
  if (looksLikeSecretKeyLocal(publishableKey)) {
    // Thrown rather than reported. Every other failure here degrades to a
    // form that does not work; this one is a merchant's secret key sitting in
    // a page any visitor can read, and it must stop the mount.
    throw new FormConfigError('a secret key was passed to mountForm; use the publishable key');
  }

  const root = createFormRoot(target, FORM_STYLES);
  const boot = new AbortController();

  /**
   * Set the moment a draft leaves this form, and never cleared.
   *
   * It locks {@link applyTenantShape} out for the rest of this mount. A
   * rebuild mints a NEW `submissionId` (`ui/webform-form.ts` mints one per
   * form instance), so replacing the form under an in-flight or already-sent
   * submission would turn the visitor's retry into a second submission the
   * server's idempotency guard cannot recognise as the same one — and would
   * throw away the confirmation they are looking at. A `'phone'` tenant whose
   * boot read lands after the visitor has already pressed Send keeps the
   * form they submitted; there is nothing left for a reshape to help with.
   */
  let submitting = false;

  /**
   * When the visitor first saw a form here — NOT when the current one was
   * built.
   *
   * Handed to every build, including the rebuild, so `fillMs` stays a
   * measurement of how long this VISITOR has been looking at this surface.
   * It is read as a bot signal on the other side: chat-service-node
   * `src/application/services/webform-text.ts` calls anything under
   * `minFillMs` (`src/config/index.ts`, default 2000) a bot, and
   * `src/application/services/webform.service.ts` answers a bot with a
   * fabricated 202 — a fresh receipt id naming no row, no upstream call,
   * nothing written, and the merchant's own success sentence shown to the
   * visitor. A delta restarted at the rebuild would put every visitor who
   * submits within 2 s of the boot read landing into exactly that hole, and
   * a browser's autofill is instant.
   */
  const startedAt = Date.now();

  function build(requirement: ContactRequirement, copy: FormCopy | null): WebformView {
    return createWebformForm(
      {
        // No chat to offer: this bundle has no socket, no session and no
        // launcher, so "Try live chat anyway" would be a button to nowhere.
        alternative: null,
        // `'assumed'` + `'UNKNOWN'` is the pair that renders "Leave a message"
        // and the built-in intro rather than "We're currently offline." It is
        // also the only honest pair: this surface has no calendar and asks for
        // none, so claiming the team is closed would be a guess presented as a
        // fact. `ui/webform-form.ts`'s closed-copy guard requires BOTH
        // `published` and `CLOSED` before it says that, which is why passing
        // `'assumed'` here is safe against a future change to that resolution
        // — and is what lets the merchant's own title own every render this
        // surface can produce.
        source: 'assumed',
        hours: 'UNKNOWN',
        // The merchant's pre-chat fields belong to the chat path and arrive
        // over a route this bundle does not call.
        extraFields: [],
        contactRequirement: requirement,
        startedAt,
        // `exactOptionalPropertyTypes` is on, so an absent block is an ABSENT
        // KEY and never an explicit `undefined`.
        ...(copy === null ? {} : { copy }),
      },
      {
        onSubmit: async (draft: WebformDraft): Promise<WebformReceipt> => {
          submitting = true;
          const receipt = await submitWebform({ apiUrl, publishableKey, draft });
          options.onSubmitted?.(receipt);
          return receipt;
        },
        onError: (error: unknown) => report(onError, error),
      },
    );
  }

  /**
   * What the form on screen was built from.
   *
   * Stated rather than inferred: {@link applyTenantShape} rebuilds only when
   * the boot answer would change something, and "would it change" is a
   * comparison against what is rendered — so the first render passes
   * `DEFAULT_CONTACT_REQUIREMENT` explicitly instead of letting
   * `createWebformForm` apply it out of sight.
   */
  let rendered: ContactRequirement = DEFAULT_CONTACT_REQUIREMENT;
  let view = build(rendered, null);

  root.root.appendChild(view.node);

  /**
   * What a screen-reader user hears when the boot answer rearranges the form
   * under them.
   *
   * OUTSIDE `view.node`, and that placement is the whole mechanism: a live
   * region is announced only when its CONTENT changes while it is already in
   * the tree, so the two regions inside the form — the `role="alert"` status
   * line and the `role="status"` confirmation — cannot carry this. They are
   * replaced along with everything else, arriving empty and `hidden`, which
   * announces nothing while labels change, a hint appears and the two contact
   * fields regroup.
   *
   * `role="status"` rather than `alert`: nothing is wrong, and an assertive
   * interruption for a form that improved would be worse than the silence.
   * `.dh-sr` is `form-styles.ts`'s existing screen-reader-only geometry and
   * NO NEW CSS SHIPS WITH THIS. Not `hidden`, which would take it out of the
   * accessibility tree and make it announce nothing at all.
   *
   * ⚠️ NOT VERIFIED WITH A SCREEN READER — jsdom builds no accessibility
   * tree. What is pinned is the node, its survival across the rebuild, and
   * that its text changes; how a reader voices it needs someone with one.
   */
  const announcer = el('p', { attrs: { class: 'dh-sr', role: 'status' } });
  root.root.appendChild(announcer);

  // ── The one degraded state this surface adds ──────────────────────────
  //
  // Rendered ABOVE the form rather than instead of it. Replacing the form
  // would throw away anything already typed, and a visitor who has written
  // out their problem and watched it vanish is worse off than one who is
  // told plainly that it cannot be sent from here. The inputs stay enabled
  // so a draft can be selected and copied somewhere useful; only Send is
  // taken away, because pressing it cannot succeed.
  function blockForSure(verdict: Extract<FormBoot, { kind: 'refused' }>): void {
    const sentence = visitorMessage(
      new WebformError(verdict.status === 401 ? 'unauthorized' : 'origin', 'form boot refused', false),
    );
    const notice = el('div', {
      attrs: { class: 'dh-form-blocked', role: 'alert' },
      children: [el('p', { attrs: { class: 'dh-form-subtitle' }, text: sentence })],
    });
    root.root.insertBefore(notice, root.root.firstChild);

    const submit = root.shadow.querySelector<HTMLButtonElement>('.dh-form-submit');
    if (submit !== null) {
      submit.disabled = true;
      submit.setAttribute('aria-disabled', 'true');
    }

    // The developer's half, with everything the route gave us to quote.
    report(
      onError,
      new WebformError(
        verdict.status === 401 ? 'unauthorized' : 'origin',
        `widget form boot → ${verdict.status} ${verdict.code ?? '(no code)'}`,
        false,
        {
          ...(verdict.code === undefined ? {} : { code: verdict.code }),
          ...(verdict.requestId === undefined ? {} : { requestId: verdict.requestId }),
        },
      ),
    );
  }

  /** Whether the merchant actually wrote any of the three. `''` is not copy —
   *  the console stores an empty field as `null`, and `ui/webform-form.ts`
   *  trims the other two to the same answer. */
  function hasCopy(copy: FormCopy | null): boolean {
    if (copy === null) return false;
    return [copy.title, copy.intro, copy.successMessage].some(
      (line) => typeof line === 'string' && line.trim() !== '',
    );
  }

  /**
   * Rebuilds the form from what the tenant's boot read actually said.
   *
   * ── Why a rebuild, and not a patch ──────────────────────────────────────
   *
   * The rule reaches further into the form than the two `required` flags a
   * patch could reach: under `'either'` a hint element appears ABOVE both
   * boxes, the two fields are regrouped under it, both labels lose their
   * " (optional)" mark, an `aria-describedby` is wired, and the submit path
   * grows a pair check. All of that is `createWebformForm`'s, decided in one
   * shot at build time. Reaching in to reproduce it here would be a second
   * implementation of the tenant rule, and the two would drift — which is the
   * same argument this module's header makes for not writing a second form.
   *
   * ── Why it is usually skipped ───────────────────────────────────────────
   *
   * Only when something on screen would change. The common tenant — the
   * server's own default rule, no copy written — renders identically either
   * way, and rebuilding for a no-op would move focus and restart `fillMs` for
   * nothing. `submitting` is the other half: see its declaration.
   *
   * ── What survives ──────────────────────────────────────────────────────
   *
   * Whatever is in the boxes, by field id. A browser's autofill is instant and
   * this read is not, so "nothing can have been typed yet" is not true —
   * it is the one thing a visitor would notice being taken away. The honeypot
   * crosses over with the rest (a bot's fill is evidence, not noise), and so
   * does focus, which would otherwise land on `<body>` mid-sentence.
   *
   * `fillMs` does NOT restart. The replacement form is genuinely new, but the
   * delta it reports is not about the form — it is about how long the VISITOR
   * has been here, and the server destroys any submission under 2 s as a bot.
   * `startedAt` above carries the origin across; the seam is one optional
   * number on `createWebformForm`'s options, which is a far smaller coupling
   * than a `fillMs` this module would otherwise have to reason about blind.
   *
   * A VISIBLE validation message crosses over too. A client-side failure
   * returns BEFORE `callbacks.onSubmit`, so it never sets `submitting` and
   * this path is wide open under it: a visitor who pressed Send and was told
   * "Please tell us what you need." would otherwise watch that sentence
   * deleted by a network read they never asked for.
   *
   * ── What is said out loud ────────────────────────────────────────────
   *
   * The rearrangement is real — labels lose a mark, a hint appears, two
   * fields regroup — and a sighted visitor watches it happen. `announcer`
   * above is that same event for a visitor who cannot, and writing it is the
   * last thing this does.
   */
  function applyTenantShape(requirement: ContactRequirement, copy: FormCopy | null): void {
    if (submitting) return;
    if (requirement === rendered && !hasCopy(copy)) return;

    const typed = new Map<string, string>();
    for (const box of view.node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    )) {
      if (box.id !== '' && box.value !== '') typed.set(box.id, box.value);
    }
    const focused = root.shadow.activeElement instanceof HTMLElement ? root.shadow.activeElement.id : '';

    // Read BEFORE the swap, off the form being replaced, and only when it is
    // VISIBLE: `createStatusLine` leaves its node in the tree with `hidden`
    // set and no text when there is nothing to say, and re-showing that would
    // put an empty alert on screen.
    const warningNode = view.node.querySelector<HTMLElement>('.dh-form-error');
    const warning =
      warningNode !== null && !warningNode.hidden ? (warningNode.textContent ?? '') : '';
    const reshaped = requirement !== rendered;

    const next = build(requirement, copy);
    root.root.replaceChild(next.node, view.node);
    view.destroy();
    view = next;
    rendered = requirement;

    // Matched by walking the new subtree rather than by building a selector
    // out of an id. Not fastidiousness: `CSS.escape` is the only correct way
    // to put an arbitrary id into a selector, `CSS` is a GLOBAL, and it is
    // absent in jsdom — so a selector here throws in this package's own test
    // environment and would throw in any other host that lacks it. The ids in
    // play are `createField`'s own and would not need escaping; depending on a
    // global to handle ones that do not exist is the part that is wrong.
    for (const box of next.node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    )) {
      const value = typed.get(box.id);
      if (value !== undefined) box.value = value;
    }
    if (focused !== '') {
      for (const element of next.node.querySelectorAll<HTMLElement>('[id]')) {
        if (element.id !== focused) continue;
        element.focus({ preventScroll: true });
        break;
      }
    }

    // Written AFTER the replacement is in the tree, which is what makes it an
    // announcement rather than a node that quietly appears already holding
    // text. Re-shown verbatim rather than recomputed: the rebuild did not
    // change what the visitor still has to do about it.
    if (warning !== '') {
      const shown = next.node.querySelector<HTMLElement>('.dh-form-error');
      if (shown !== null) {
        shown.textContent = warning;
        shown.hidden = false;
      }
    }

    announcer.textContent = reshaped ? RESHAPE_NOTICE[requirement] : COPY_NOTICE;
  }

  // ── The caps, applied as attributes rather than discovered as a 400 ────
  //
  // The submit route enforces `WEBFORM_LIMITS` and refuses an over-long name
  // with a 400 — AFTER the visitor has written out their whole problem. The
  // boot read publishes a projection of that same constant for exactly this
  // reason, so the cap becomes a `maxlength` the browser enforces while they
  // type. Applied late, which is the right trade: the field that realistically
  // overruns is the message, and `ui/webform-form.ts` already caps that one at
  // build time from `WEBFORM_MESSAGE_MAX` — so nothing important is waiting on
  // a network call, and the three contact fields get their real caps as soon
  // as the server states them.
  //
  // Written onto the inputs after the fact rather than passed in, because
  // `ui/webform-form.ts` takes no limits argument. That is reaching into a
  // rendered subtree, and it is bounded: the ids are `createField`'s own,
  // derived from the `'dh-webform'` prefix this module passes it, and the
  // whole subtree belongs to this mount.
  function applyLimits(limits: FormFieldLimits): void {
    for (const field of ['name', 'email', 'phone'] as const) {
      const cap = limits[field];
      if (cap === undefined || cap <= 0) continue;
      root.shadow.querySelector<HTMLInputElement>(`#dh-webform-${field}`)?.setAttribute(
        'maxlength',
        String(cap),
      );
    }
  }

  // Installed AFTER the form is in the DOM, so the first height reported is a
  // measurement of the rendered form rather than of an empty element.
  const resizeReporter = installResizeReporter(root.host, options.parentOrigin);

  // Started AFTER the form is in the DOM, so there is no ordering in which a
  // slow read delays a render. Not awaited by anything.
  void readFormBoot({ apiUrl, publishableKey, signal: boot.signal }).then((verdict) => {
    if (boot.signal.aborted) return;
    if (verdict.kind === 'refused') {
      blockForSure(verdict);
      return;
    }
    if (verdict.kind !== 'ok') return;
    // Shape BEFORE caps: `applyLimits` writes `maxlength` onto the inputs that
    // are in the tree, and a rebuild after it would replace exactly those.
    applyTenantShape(verdict.contactRequirement, verdict.form);
    applyLimits(verdict.limits);
  });

  const handle: MountedForm = {
    host: root.host,
    shadow: root.shadow,
    focus() {
      view.focus();
    },
    destroy() {
      boot.abort();
      resizeReporter.stop();
      view.destroy();
      root.destroy();
      mounted.delete(target);
    },
  };

  mounted.set(target, handle);
  return handle;
}

/** The mounted form for `target`, or `null`. */
export function getMountedForm(target: Element): MountedForm | null {
  return mounted.get(target) ?? null;
}

// ── The `<script src="…/form.js">` half ───────────────────────────────────
//
// Bundled by `scripts/bundle.mjs`, which supplies a three-line entry that
// calls `installFormGlobal()`. The entry is in the build script rather than
// in `src/` because the auto-boot is a property of THAT ARTIFACT — the npm
// package must not install a global or scan the document on import — and the
// logic it runs is here, where it is testable.

/** The API a `<script>`-tag integrator gets, on `window.DhaamForm`. */
export interface DhaamFormGlobal {
  mount(target: Element, options: MountFormOptions): MountedForm;
  get(target: Element): MountedForm | null;
}

function reportBootFailure(error: unknown): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[@dhaam-ccrm/widget] form failed to start', error);
  }
}

/**
 * The tag that loaded us.
 *
 * `document.currentScript` is correct only while the script evaluates
 * synchronously and is `null` for a module script or one appended by a
 * loader. The fallback finds our tag by a marker attribute rather than by
 * `src`: a CDN, a proxy or a tag manager will each rewrite the URL, so a
 * `src.includes('form.js')` test would find nothing.
 */
function locateScript(): HTMLElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLElement) return current;
  return document.querySelector<HTMLElement>('script[data-publishable-key][data-api-url]');
}

/**
 * Mounts a form into every element the script tag points at.
 *
 * One selector, defaulting to `[data-dhaam-form]`:
 *
 *   <script src="…/form.js"
 *           data-publishable-key="dhp_live_…"
 *           data-api-url="https://chat.example.com"></script>
 *   <div data-dhaam-form></div>
 *
 * A failure to find a target is silent. A page that includes this file for
 * the `window.DhaamForm` API and mounts by hand is a legitimate way to use
 * it, and warning about it would train integrators to ignore our output.
 */
export function bootFormsFromDocument(): void {
  const script = locateScript();
  if (script === null) return;
  if (script.dataset['auto'] === 'false') return;

  const publishableKey = script.dataset['publishableKey'];
  const apiUrl = script.dataset['apiUrl'];
  if (publishableKey === undefined || apiUrl === undefined) return;

  const selector = script.dataset['target'] ?? '[data-dhaam-form]';
  for (const target of document.querySelectorAll(selector)) {
    try {
      mountForm(target, { apiUrl, publishableKey });
    } catch (error) {
      // One bad target must not stop the rest, and nothing here may reach the
      // host page as an exception — this file evaluates inside someone's
      // contact page and an escape lands in THEIR error tracker.
      reportBootFailure(error);
    }
  }
}

/**
 * Installs `window.DhaamForm` and boots once the document has a body.
 *
 * Not overwritten if present: a second copy of this bundle must not swap out
 * an API object the host may already hold a reference to.
 */
export function installFormGlobal(): void {
  try {
    const api: DhaamFormGlobal = { mount: mountForm, get: getMountedForm };
    const target = window as unknown as Record<string, unknown>;
    target['DhaamForm'] ??= api;

    const run = (): void => {
      try {
        bootFormsFromDocument();
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
