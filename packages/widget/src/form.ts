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
// ── What this module does NOT do, and why it is listed ───────────────────
//
// It does not render the merchant's own `form.title` / `form.intro` /
// `form.successMessage`, even when `GET /widget/form` returns them.
// `ui/webform-form.ts` hardcodes those three strings and takes no copy
// argument, and that file is currently pinned by SHA-256 by two console
// tasks. Parameterising it is a real change with a real cost to other work,
// not something to take as a side effect of this slice. The boot read is
// PARSED here — `readFormBoot` returns the copy — so the surface above can
// decide, but nothing in this file renders it yet. Absent copy and present
// copy therefore look identical today, which is exactly the built-in-strings
// case working, and is the honest half of that.
//
// ── The failure a visitor sees ───────────────────────────────────────────
//
// A blank rectangle on a merchant's contact page is the outcome designed
// against, so the form renders SYNCHRONOUSLY and unconditionally. Nothing is
// awaited before first paint and no upstream answer can produce an empty
// element. The boot read runs alongside and can only ADD the notice below,
// never withhold the form.

import { createFormRoot } from './ui/form-root.js';
import { FORM_STYLES } from './ui/form-styles.js';
import { createWebformForm } from './ui/webform-form.js';
import { el } from './ui/dom.js';
import { WebformError, submitWebform, visitorMessage } from './webform.js';
import type { WebformDraft, WebformReceipt } from './webform.js';

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

/** The tenant's own copy, when they wrote any. `null` when they did not. */
export interface FormCopy {
  readonly title: string | null;
  readonly intro: string | null;
  readonly successMessage: string | null;
}

/** Which contact detail the SUBMIT route will insist on for this tenant. */
export type ContactRequirement = 'email' | 'phone' | 'either';

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
  return value === 'email' || value === 'phone' ? value : 'either';
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

  const view = createWebformForm(
    {
      // No chat to offer: this bundle has no socket, no session and no
      // launcher, so "Try live chat anyway" would be a button to nowhere.
      alternative: null,
      // `'assumed'` + `'UNKNOWN'` is the pair that renders "Leave a message"
      // and "We'll reply by email." — the built-in strings. It is also the
      // only honest pair: this surface has no calendar and asks for none, so
      // claiming "We're currently offline" would be a guess presented as a
      // fact. `ui/webform-form.ts`'s closed-copy guard requires BOTH
      // `published` and `CLOSED` before it says that, which is why passing
      // `'assumed'` here is safe against a future change to that resolution.
      source: 'assumed',
      hours: 'UNKNOWN',
      // The merchant's pre-chat fields belong to the chat path and arrive
      // over a route this bundle does not call.
      extraFields: [],
    },
    {
      onSubmit: async (draft: WebformDraft): Promise<WebformReceipt> => {
        const receipt = await submitWebform({ apiUrl, publishableKey, draft });
        options.onSubmitted?.(receipt);
        return receipt;
      },
      onError: (error: unknown) => report(onError, error),
    },
  );

  root.root.appendChild(view.node);

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

  // Started AFTER the form is in the DOM, so there is no ordering in which a
  // slow read delays a render. Not awaited by anything.
  void readFormBoot({ apiUrl, publishableKey, signal: boot.signal }).then((verdict) => {
    if (boot.signal.aborted) return;
    if (verdict.kind === 'refused') {
      blockForSure(verdict);
      return;
    }
    if (verdict.kind === 'ok') applyLimits(verdict.limits);
  });

  const handle: MountedForm = {
    host: root.host,
    shadow: root.shadow,
    focus() {
      view.focus();
    },
    destroy() {
      boot.abort();
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
