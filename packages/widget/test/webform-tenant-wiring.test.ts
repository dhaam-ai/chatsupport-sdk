// @vitest-environment jsdom
//
// The tenant's contact rule and copy, from the WIRE to a RENDERED FORM.
//
// `webform-tenant-shape.test.ts` already proves that `createWebformForm`
// honours `contactRequirement` and `copy` when it is handed them. It proves
// nothing about whether anything ever hands them over, and for a while
// nothing did: the merchant configured the rule in the console, the server
// enforced it on submit, both boot routes published it, and every visitor on
// both surfaces still saw the `'email'` shape. A feature implemented and
// consumed by nobody.
//
// So the boundary here is deliberately NOT `createWebformForm`'s options
// object. It is what a visitor is looking at:
//
//   • which of Email / Phone carries " (optional)" in its label
//   • which one's `<input>` reports `required`
//   • the heading, the line under it, and the sentence after Send
//
// and the only input is a wire body. Everything between the two is under
// test, including the hop that used to be missing.
//
// ⚠️ jsdom applies no cascade and computes no layout. Every claim here is
// structural — an attribute, a text node, or DOM order.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountForm } from '../src/form.js';
import { mount, unmount } from '../src/index.js';
import { OFFLINE_MODE } from '../src/remote-config.js';
import { DEFAULT_CONTACT_REQUIREMENT } from '../src/ui/webform-form.js';
import type { WidgetConfig } from '../src/config.js';

// Assembled at runtime, never a contiguous literal — a literal here blocks the
// push on secret scanning and trips a customer's scanner if they copy a test.
const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';

/**
 * The server's own fallback, restated as a bare literal.
 *
 * `chat-service-node src/validators/webform.validator.ts`'s
 * `DEFAULT_CONTACT_REQUIREMENT`, applied at submit and on both boot routes.
 * Spelled out rather than imported from the SDK constant it is compared
 * against, because a test that reads the same symbol the implementation reads
 * cannot fail when that symbol drifts away from the server — which is the one
 * failure this pin exists for. An `'email'` default demands a detail the
 * server does not require.
 */
const SERVER_FALLBACK = 'either';

// ── Shared readers ────────────────────────────────────────────────────────

/** The label element's own text, " (optional)" mark INCLUDED. */
function labelIn(root: ParentNode, inputId: string): string {
  const label = root.querySelector(`label[for="${inputId}"]`);
  if (label === null) throw new Error(`no label for ${inputId}`);
  return label.textContent ?? '';
}

function inputIn(root: ParentNode, id: string): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(`#${id}`);
  if (found === null) throw new Error(`no #${id}`);
  return found;
}

/**
 * What a visitor can actually tell about the two contact fields, as one
 * value — so a failure names the whole rendered shape rather than the first
 * assertion that happened to trip.
 */
function contactShape(root: ParentNode): Record<string, unknown> {
  return {
    emailLabel: labelIn(root, 'dh-webform-email'),
    emailRequired: inputIn(root, 'dh-webform-email').required,
    phoneLabel: labelIn(root, 'dh-webform-phone'),
    phoneRequired: inputIn(root, 'dh-webform-phone').required,
    hint: root.querySelector('#dh-webform-contact-hint')?.textContent ?? null,
  };
}

/** The `'phone'` tenant's form: Phone demanded, Email offered. */
const PHONE_TENANT_SHAPE = {
  emailLabel: 'Email (optional)',
  emailRequired: false,
  phoneLabel: 'Phone',
  phoneRequired: true,
  hint: null,
};

/**
 * The `'either'` tenant's form: the email unmarked because a reply needs it,
 * the phone still marked optional because nothing does. Neither is `required`
 * on the ELEMENT — the rule is cross-field and `run`'s backstop owns it.
 */
const EITHER_TENANT_SHAPE = {
  emailLabel: 'Email',
  emailRequired: false,
  phoneLabel: 'Phone (optional)',
  phoneRequired: false,
  hint: 'Add an email address so we can reply. A phone number is optional.',
};

/** A 200 from the boot route, with only what a test cares about stated. */
function boot(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function shadowOf(host: HTMLElement): ShadowRoot {
  const root = host.shadowRoot;
  if (root === null) throw new Error('the mounted host has no shadow root');
  return root;
}

// ── (a) The standalone form — `mountForm` ─────────────────────────────────

describe('the standalone form renders the tenant that `GET /widget/form` described', () => {
  let target: HTMLElement;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    target.remove();
  });

  it('marks Phone required and Email optional for a `phone` tenant', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(boot({ contactRequirement: 'phone' })));

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    const shadow = shadowOf(mounted.host);

    // Polled rather than flushed: this assertion is a PRESENCE, so waiting
    // for it is honest. The form is on screen from the first tick — the
    // question is only whether the tenant's answer ever reaches it.
    await vi.waitFor(() => expect(contactShape(shadow)).toEqual(PHONE_TENANT_SHAPE));

    mounted.destroy();
  });

  it("renders the merchant's own title, intro and success sentence", async () => {
    const submitted = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outcome: 'ticket', receiptId: 'r1', duplicate: false }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/widget/webform')
          ? submitted(String(input), init)
          : boot({
              contactRequirement: 'email',
              form: {
                title: 'Contact the crew',
                intro: 'We answer within a working day.',
                successMessage: 'Got it. Someone will be in touch.',
              },
            }),
      ),
    );

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    const shadow = shadowOf(mounted.host);

    await vi.waitFor(() =>
      expect(shadow.querySelector('.dh-form-heading')?.textContent).toBe('Contact the crew'),
    );
    expect(shadow.querySelector('.dh-form-subtitle')?.textContent).toBe(
      'We answer within a working day.',
    );

    inputIn(shadow, 'dh-webform-email').value = 'ada@example.com';
    shadow.querySelector<HTMLTextAreaElement>('#dh-webform-message')!.value = 'Where is my order?';
    shadow.querySelector<HTMLFormElement>('form')!.requestSubmit();

    await vi.waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      // Verbatim. Nothing is spliced into a sentence the merchant wrote.
      expect(shadow.querySelector('.dh-offline-sent .dh-form-subtitle')?.textContent).toBe(
        'Got it. Someone will be in touch.',
      ),
    );

    mounted.destroy();
  });

  // An unreadable rule must land where the SERVER lands, not where this
  // package's history lands. Both directions of "unreadable" are pinned:
  // the key absent, and a value a newer console writes that this bundle has
  // never heard of.
  it.each<[string, Record<string, unknown>]>([
    ['the key is absent', { limits: { email: 320 } }],
    ['the value is one this bundle has never heard of', { contactRequirement: 'sms' }],
    ['the value is not a string', { contactRequirement: 7 }],
  ])("falls back to the server's own default when %s", async (_label, data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(boot(data)));

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    const shadow = shadowOf(mounted.host);

    await vi.waitFor(() => expect(contactShape(shadow)).toEqual(EITHER_TENANT_SHAPE));

    mounted.destroy();
  });

  // The read is not instant and a browser's autofill is. A form that throws
  // away what is already in the boxes the moment the tenant's answer lands is
  // a worse form than one that never read it.
  it('keeps what is already typed when the tenant answer reshapes the form', async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    const shadow = shadowOf(mounted.host);

    inputIn(shadow, 'dh-webform-email').value = 'ada@example.com';
    shadow.querySelector<HTMLTextAreaElement>('#dh-webform-message')!.value = 'Where is my order?';

    release(boot({ contactRequirement: 'phone' }));
    await vi.waitFor(() => expect(contactShape(shadow)).toEqual(PHONE_TENANT_SHAPE));

    expect(inputIn(shadow, 'dh-webform-email').value).toBe('ada@example.com');
    expect(shadow.querySelector<HTMLTextAreaElement>('#dh-webform-message')!.value).toBe(
      'Where is my order?',
    );

    mounted.destroy();
  });
});

// ── The rebuild that answer triggers ─────────────────────────────────────
//
// `applyTenantShape` does not patch the form; it REPLACES the whole subtree.
// Everything below is something a visitor is holding at the moment that
// happens. Each one was reasoned about in a comment and pinned by nothing,
// which is how a rebuild that silently destroys a submission ships — so the
// boundary here stays where it is above: what is on screen, and the one
// request body that leaves the page.

describe('the rebuild the tenant answer triggers keeps the visitor whole', () => {
  let target: HTMLElement;
  /** Resolves the held boot read. Reassigned by the `fetch` stub below. */
  let release: (value: Response) => void = () => {};
  let submitted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    release = () => {};
    submitted = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outcome: 'ticket', receiptId: 'r1', duplicate: false }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    // The boot read is HELD, so each test decides for itself when the tenant's
    // answer lands and what the visitor has already done by then — which is
    // the only variable any of these are about. Submits are answered at once.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/widget/webform')
          ? submitted(String(input), init)
          : new Promise<Response>((resolve) => {
              release = resolve;
            }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    target.remove();
  });

  function mountHere(): ShadowRoot {
    return shadowOf(mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE }).host);
  }

  /**
   * Enough real macrotask turns for the boot chain — and the submit chain
   * behind it — to land. Real timers only, and no `Date.now`, so it is safe
   * in the one test below that freezes the clock. `vi.waitFor` is not: it
   * measures its own deadline against a clock that test stops.
   */
  async function drain(): Promise<void> {
    for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function messageIn(root: ParentNode): HTMLTextAreaElement {
    const box = root.querySelector<HTMLTextAreaElement>('#dh-webform-message');
    if (box === null) throw new Error('no message box');
    return box;
  }

  function formIn(root: ParentNode): HTMLFormElement {
    const form = root.querySelector<HTMLFormElement>('form');
    if (form === null) throw new Error('no form');
    return form;
  }

  /** `createStatusLine`'s node — the `role="alert"` a visitor is shown. */
  function alertIn(root: ParentNode): HTMLElement {
    const node = root.querySelector<HTMLElement>('.dh-form-error');
    if (node === null) throw new Error('no status line');
    return node;
  }

  /** What is on screen in the alert, as one value. */
  function alertShape(root: ParentNode): Record<string, unknown> {
    const node = alertIn(root);
    return { hidden: node.hidden, text: node.textContent };
  }

  function sentBody(): Record<string, unknown> {
    const init = submitted.mock.calls[0]?.[1] as RequestInit | undefined;
    if (init?.body === undefined) throw new Error('nothing was submitted');
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  // ── `fillMs` ────────────────────────────────────────────────────────────
  //
  // Not a statistic. `fillMs` is read by chat-service-node
  // `src/application/services/webform-text.ts` against `minFillMs`
  // (`src/config/index.ts`, default 2000), and a submission under that floor
  // is answered with a FABRICATED 202 carrying a receipt id that names no row
  // — `src/application/services/webform.service.ts` on `bot.bot`. Nothing is
  // written and nobody is told. So a `fillMs` that restarts at the rebuild
  // destroys the message of any visitor who submits within 2 s of the boot
  // read landing, while showing them the merchant's own success sentence.
  it('measures `fillMs` from the first paint, not from the rebuild', async () => {
    let now = 1_757_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const shadow = mountHere();

    // Five seconds of a visitor reading the form, while the boot read that
    // will reshape it is still in flight.
    now += 5_000;
    release(boot({ contactRequirement: 'phone' }));
    await drain();
    expect(contactShape(shadow)).toEqual(PHONE_TENANT_SHAPE);

    now += 1_000;
    inputIn(shadow, 'dh-webform-phone').value = '+44 7700 900123';
    messageIn(shadow).value = 'Where is my order?';
    formIn(shadow).requestSubmit();
    await drain();

    expect(submitted).toHaveBeenCalledTimes(1);
    // Six seconds since the form was first painted. NOT one second since the
    // form that replaced it was built.
    expect(sentBody()['fillMs']).toBe(6_000);
  });

  // ── What a visitor is already being told ────────────────────────────────
  //
  // A client-side validation failure returns before `callbacks.onSubmit`, so
  // it never sets `submitting` and never locks the rebuild out. The visitor
  // is looking at a live `role="alert"` and the rebuild takes it away.
  it('keeps a validation message the visitor is already reading', async () => {
    const shadow = mountHere();

    inputIn(shadow, 'dh-webform-email').value = 'ada@example.com';
    formIn(shadow).requestSubmit();
    await drain();
    expect(submitted).not.toHaveBeenCalled();
    expect(alertShape(shadow)).toEqual({ hidden: false, text: 'Please tell us what you need.' });

    release(boot({ contactRequirement: 'phone' }));
    await drain();
    expect(contactShape(shadow)).toEqual(PHONE_TENANT_SHAPE);

    expect(alertShape(shadow)).toEqual({ hidden: false, text: 'Please tell us what you need.' });
  });

  // ── The rearrangement itself ────────────────────────────────────────────
  //
  // Labels change, a hint node appears and the two contact fields regroup.
  // Both live regions inside the form are replaced ALONG WITH it, and a live
  // region announces a change only if it was in the tree before the change —
  // so a form that only swaps its own subtree rearranges itself in silence.
  it('announces the rearrangement instead of changing the form in silence', async () => {
    const shadow = mountHere();

    const live = shadow.querySelector<HTMLElement>('.dh-sr[role="status"]');
    expect(live).not.toBeNull();
    // Silent until something happens, and NOT `hidden`: a hidden live region
    // announces nothing at all.
    expect({ text: live!.textContent, hidden: live!.hidden }).toEqual({ text: '', hidden: false });

    release(boot({ contactRequirement: 'phone' }));
    await drain();
    expect(contactShape(shadow)).toEqual(PHONE_TENANT_SHAPE);

    // The SAME node, not a replacement carrying text. That is the whole
    // property: it has to outlive the subtree it is describing.
    expect(shadow.querySelector('.dh-sr[role="status"]')).toBe(live);
    expect(live!.hidden).toBe(false);
    expect(live!.textContent).not.toBe('');
  });

  // ── `if (submitting) return;` ───────────────────────────────────────────
  it('does not rebuild under a confirmation the visitor is reading', async () => {
    const shadow = mountHere();

    inputIn(shadow, 'dh-webform-email').value = 'ada@example.com';
    messageIn(shadow).value = 'Where is my order?';
    formIn(shadow).requestSubmit();
    await drain();

    const sent = shadow.querySelector<HTMLElement>('.dh-offline-sent');
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(sent).not.toBeNull();
    expect(sent!.hidden).toBe(false);

    release(boot({ contactRequirement: 'phone' }));
    await drain();

    // The very same node, still on screen. A rebuild replaces `.dh-webform`
    // wholesale — confirmation included — and mints a fresh `submissionId`
    // with it, so the visitor would be looking at an empty form and their
    // retry would file a SECOND submission the server cannot recognise.
    expect(shadow.querySelector('.dh-offline-sent')).toBe(sent);
    expect(sent!.hidden).toBe(false);
    expect(contactShape(shadow)).toEqual(EITHER_TENANT_SHAPE);
  });

  // ── `if (requirement === rendered && !hasCopy(copy)) return;` ───────────
  it('leaves the form alone when the tenant answer changes nothing on screen', async () => {
    const shadow = mountHere();
    const before = shadow.querySelector('.dh-webform');
    const email = inputIn(shadow, 'dh-webform-email');

    // The common tenant: the server's own default rule, no copy written.
    release(boot({ contactRequirement: 'either' }));
    await drain();

    expect(shadow.querySelector('.dh-webform')).toBe(before);
    expect(inputIn(shadow, 'dh-webform-email')).toBe(email);
  });

  // The other half of the same condition: copy alone still has to rebuild.
  it('still rebuilds for copy alone, when the rule itself did not move', async () => {
    const shadow = mountHere();

    release(boot({ contactRequirement: 'either', form: { title: 'Contact the crew' } }));
    await drain();

    expect(shadow.querySelector('.dh-form-heading')?.textContent).toBe('Contact the crew');
    expect(contactShape(shadow)).toEqual(EITHER_TENANT_SHAPE);
  });

  // ── The focus restore ───────────────────────────────────────────────────
  it('puts focus back in the box the visitor was typing in', async () => {
    const shadow = mountHere();
    const before = messageIn(shadow);
    before.focus();
    expect(shadow.activeElement).toBe(before);

    release(boot({ contactRequirement: 'phone' }));
    await drain();
    expect(contactShape(shadow)).toEqual(PHONE_TENANT_SHAPE);

    const after = messageIn(shadow);
    // It really was rebuilt — otherwise this test would pass on a form that
    // never moved and prove nothing about restoring anything.
    expect(after).not.toBe(before);
    expect(shadow.activeElement).toBe(after);
  });

  // ── `applyTenantShape` BEFORE `applyLimits` ─────────────────────────────
  //
  // The caps are written as `maxlength` onto the inputs that are in the tree.
  // Reverse the two calls and every cap lands on boxes the rebuild is about
  // to throw away, silently un-capping the form the visitor actually types
  // into — nothing else in the suite notices.
  it('leaves the tenant caps on the boxes the rebuild produced', async () => {
    const shadow = mountHere();

    release(boot({ contactRequirement: 'phone', limits: { name: 80, email: 320, phone: 32 } }));
    await drain();
    expect(contactShape(shadow)).toEqual(PHONE_TENANT_SHAPE);

    expect({
      name: inputIn(shadow, 'dh-webform-name').getAttribute('maxlength'),
      email: inputIn(shadow, 'dh-webform-email').getAttribute('maxlength'),
      phone: inputIn(shadow, 'dh-webform-phone').getAttribute('maxlength'),
    }).toEqual({ name: '80', email: '320', phone: '32' });
  });
});

// ── (b) The in-widget form — `mount` ──────────────────────────────────────

class SilentSocket {
  static readonly CONNECTING = 0;
  readonly readyState = 0;
  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

function widgetConfig(): WidgetConfig {
  return {
    auth: { publishableKey: PUBLISHABLE, tokenEndpoint: '/api/chat-token' },
    identity: { userId: 'cus_1' },
    apiUrl: API_URL,
    wsUrl: 'wss://chat.example.com',
    onError: () => undefined,
  };
}

/** The published-config body, with only what a test cares about overridden. */
function published(data: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    data: {
      enabled: true,
      appearance: {},
      behaviour: {},
      offlineMode: OFFLINE_MODE.SHOW_MESSAGE,
      isOpenNow: null,
      flows: [],
      publishedVersion: 1,
      ...data,
    },
  };
}

function stubWidgetFetch(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/widget/config')) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/chat/sessions/customer')) {
        return new Response(JSON.stringify({ success: true, data: { sessions: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/chat/sessions/')) {
        return new Response(JSON.stringify({ success: true, data: { messages: [], hasMore: false } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function widgetShadow(): ShadowRoot {
  const element = document.querySelector<HTMLElement>('dh-chat-widget');
  if (element?.shadowRoot == null) throw new Error('widget not mounted');
  return element.shadowRoot;
}

/** Lets a fetch's promise chain, and everything chained off it, land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the in-widget form renders the tenant that `GET /widget/config` described', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('WebSocket', SilentSocket);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
  });

  async function openPanel(body: unknown): Promise<void> {
    stubWidgetFetch(body);
    const widget = mount(widgetConfig());
    await settle();
    widget.open();
    await settle();
  }

  // Row 2's CTA — `openWebform`, the surface a visitor opens by hand.
  it('marks Phone required and Email optional on the surface the visitor opens', async () => {
    await openPanel(
      published({
        support: { primary: 'ticket', secondary: 'chat', hours: 'CLOSED' },
        form: { contactRequirement: 'phone' },
      }),
    );

    widgetShadow().querySelector<HTMLButtonElement>('.dh-home-cta')!.click();
    await settle();

    expect(widgetShadow().querySelector('.dh-webform-form')).not.toBeNull();
    expect(contactShape(widgetShadow())).toEqual(PHONE_TENANT_SHAPE);
  });

  // Gate 1 — the automatic form that stands in for the composer when a Row-2
  // tenant is closed under COLLECT_MESSAGE. A DIFFERENT call site in
  // `widget.ts`, and wiring one and not the other is exactly the kind of gap
  // this file exists to close.
  it('marks Phone required and Email optional on the automatic offline surface', async () => {
    await openPanel(
      published({
        offlineMode: OFFLINE_MODE.COLLECT_MESSAGE,
        isOpenNow: false,
        support: { primary: 'ticket', secondary: 'chat', hours: 'CLOSED' },
        form: { contactRequirement: 'phone' },
      }),
    );

    expect(widgetShadow().querySelector('.dh-webform-form')).not.toBeNull();
    expect(contactShape(widgetShadow())).toEqual(PHONE_TENANT_SHAPE);
  });

  // The `form` block is ABSENT whenever the deployment's web form is off, and
  // that is the common case, not an edge one.
  it.each<[string, Record<string, unknown>]>([
    ['the whole `form` block is absent', {}],
    ['`form` is present but names no rule', { form: {} }],
    ['the rule is one this bundle has never heard of', { form: { contactRequirement: 'sms' } }],
    ['`form` is not an object at all', { form: 'yes' }],
  ])("falls back to the server's own default when %s", async (_label, extra) => {
    await openPanel(
      published({ support: { primary: 'ticket', secondary: 'chat', hours: 'CLOSED' }, ...extra }),
    );

    widgetShadow().querySelector<HTMLButtonElement>('.dh-home-cta')!.click();
    await settle();

    expect(contactShape(widgetShadow())).toEqual(EITHER_TENANT_SHAPE);
  });
});

// ── The fallback itself ───────────────────────────────────────────────────

describe('the fallback both surfaces share', () => {
  // The one assertion in this file that is about a symbol rather than a
  // rendered node, and it earns its place: the two shapes above are what
  // `'either'` LOOKS like, and this is what says `'either'` is the value the
  // server would have used. Without it, both surfaces could agree perfectly
  // with each other and disagree with chat-service.
  it("is the server's own DEFAULT_CONTACT_REQUIREMENT", () => {
    expect(DEFAULT_CONTACT_REQUIREMENT).toBe(SERVER_FALLBACK);
  });
});
