// @vitest-environment jsdom
//
// `mountForm` — the standalone web form, mounted into a stranger's page with
// no chat widget, no session and no socket behind it.
//
// What is proved here is the half that a unit test CAN prove: what is in the
// DOM, what is fetched, and what survives a second mount and a destroy. It
// cannot prove that the thing LOOKS right — jsdom applies no cascade, so
// every style claim in this package's report is a source-level claim.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FORM_BOOT_PATH, looksLikeSecretKeyLocal, mountForm, readFormBoot } from '../src/form.js';
import { looksLikeSecretKey } from '../src/auth.js';
import { WEBFORM_PATH } from '../src/webform.js';

// Assembled at runtime, never a contiguous literal — a literal here blocks the
// push on secret scanning and trips a customer's scanner if they copy a test.
const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** The 200 every degraded upstream state produces: no `form` block at all. */
function bootWithoutFormBlock(): Response {
  return jsonResponse(200, {
    success: true,
    data: {
      contactRequirement: 'either',
      limits: { name: 120, email: 320, phone: 32, subject: 200, message: 4000 },
    },
  });
}

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

/** The rendered form, reached through the open shadow root. */
function shadowOf(host: HTMLElement): ShadowRoot {
  const root = host.shadowRoot;
  if (root === null) throw new Error('the mounted host has no shadow root');
  return root;
}

/**
 * Waits past the boot read's ENTIRE promise chain, not just its first await.
 *
 * `mountForm` calls `fetch` SYNCHRONOUSLY, so a `vi.waitFor` on the mock's
 * call count resolves on its own first immediate check — before `await fetch`
 * → `await response.json()` → `.then(verdict …)` has had a turn. Any
 * assertion made there is being made against a form the verdict has never
 * reached, which is how a test that asserts an ABSENCE passes whatever the
 * code does.
 *
 * An absence is why this is a wait rather than a `waitFor`: the verdict these
 * tests care about is `kind: 'unknown'`, which is DEFINED as changing nothing,
 * so there is no post-condition to poll for. Twenty macrotask turns, so every
 * queued continuation in the chain gets one regardless of whether the runtime
 * settles `Response.json()` on a microtask or a task.
 *
 * The last test in this describe pins that this is long enough. If it ever
 * stops being, that test goes red and every absence asserted after a
 * `flushBoot()` is known-suspect rather than quietly vacuous.
 */
async function flushBoot(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

describe('mountForm — the absent `form` block, which is the COMMON case', () => {
  it('renders a usable form with built-in strings, synchronously, before any read lands', () => {
    // Never resolves. The form must already be on screen anyway: every
    // degraded upstream state answers 200-with-no-`form`, and waiting on the
    // read to find that out is how a merchant's contact page gets a blank
    // rectangle for the length of a timeout.
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(() => {})));

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    const shadow = shadowOf(mounted.host);

    expect(shadow.querySelector('.dh-form-heading')?.textContent).toBe('Leave a message');
    expect(shadow.querySelector('form')).not.toBeNull();
    expect(shadow.querySelector('#dh-webform-email')).not.toBeNull();
    expect(shadow.querySelector('#dh-webform-message')).not.toBeNull();

    const submit = shadow.querySelector<HTMLButtonElement>('.dh-form-submit');
    expect(submit).not.toBeNull();
    expect(submit!.disabled).toBe(false);

    mounted.destroy();
  });

  it('leaves those built-in strings alone once the read confirms there is no `form`', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bootWithoutFormBlock());
    vi.stubGlobal('fetch', fetchMock);

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    const shadow = shadowOf(mounted.host);

    // Gated on the verdict's OWN mark, not on `fetch` having been called:
    // `fetch` is called synchronously inside `mountForm`, so a call-count
    // wait resolves before the verdict exists. `maxlength` is the one thing
    // an `ok` verdict changes here, so it is what says the verdict landed.
    await vi.waitFor(() =>
      expect(shadow.querySelector('#dh-webform-email')?.getAttribute('maxlength')).toBe('320'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(shadow.querySelector('.dh-form-heading')?.textContent).toBe('Leave a message');
    expect(shadow.querySelector<HTMLButtonElement>('.dh-form-submit')!.disabled).toBe(false);

    mounted.destroy();
  });
});

describe('mountForm — style isolation', () => {
  it('puts exactly one element in the host document and everything else in a shadow root', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootWithoutFormBlock()));

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });

    expect(target.children.length).toBe(1);
    expect(target.children[0]).toBe(mounted.host);
    expect(mounted.host.tagName.toLowerCase()).toBe('dh-web-form');
    // Open, so axe-core / Lighthouse / the browser's own inspector can walk it
    // on the merchant's page.
    expect(mounted.host.shadowRoot).not.toBeNull();
    // Nothing of ours reached the light DOM under another name.
    expect(document.querySelectorAll('.dh-webform').length).toBe(0);

    mounted.destroy();
  });

  it('carries the typography reset on a SHADOW element, not on :host', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootWithoutFormBlock()));

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    const shadow = shadowOf(mounted.host);

    // The placement is the whole isolation story: a host page's
    // `* { font-family: X !important }` matches the host element and beats
    // every `:host` rule, but cannot reach `.dh-form-root`.
    const root = shadow.querySelector('.dh-form-root');
    expect(root).not.toBeNull();
    expect(root!.contains(shadow.querySelector('form'))).toBe(true);

    const css = shadow.querySelector('style')!.textContent ?? '';
    expect(css).toMatch(/\.dh-form-root\s*\{[^}]*font-family/);
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    // The merchant's escape hatch: tokens on :host lose to an outer-document
    // rule matching the host element, which is what makes them overridable.
    expect(css).toMatch(/:host\s*\{[\s\S]*--dh-accent/);

    mounted.destroy();
  });
});

describe('mountForm — mounting twice, a non-empty target, and unmounting', () => {
  it('returns the first form and reports, rather than rendering a second', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootWithoutFormBlock()));
    const onError = vi.fn();

    const first = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError });
    const second = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError });

    expect(second).toBe(first);
    expect(target.children.length).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);

    first.destroy();
  });

  it('appends to a non-empty target and leaves what was already there', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootWithoutFormBlock()));
    const fallback = document.createElement('p');
    fallback.textContent = 'Or email us at help@example.com';
    target.appendChild(fallback);

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });

    expect(target.children.length).toBe(2);
    expect(target.contains(fallback)).toBe(true);
    expect(fallback.textContent).toBe('Or email us at help@example.com');

    mounted.destroy();
  });

  it('removes only its own element on destroy, and frees the target for a remount', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootWithoutFormBlock()));
    const fallback = document.createElement('p');
    target.appendChild(fallback);

    const first = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    first.destroy();

    expect(target.contains(fallback)).toBe(true);
    expect(target.querySelector('dh-web-form')).toBeNull();

    const onError = vi.fn();
    const second = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError });
    expect(second).not.toBe(first);
    expect(onError).not.toHaveBeenCalled();

    second.destroy();
  });

  it('mounts again after the host removed our element from a target that survived', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootWithoutFormBlock()));
    const onError = vi.fn();

    const first = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError });

    // A re-render, NOT a `destroy()`. The host wiped its own container and
    // took our `dh-web-form` with it; `target` itself is still here, so the
    // entry keyed on it is still here too and nothing collected it. This is
    // the ordinary React/Vue container, not an exotic case.
    target.innerHTML = '';

    const second = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError });

    // A real second mount, not the detached first one handed back.
    expect(second).not.toBe(first);
    expect(target.children.length).toBe(1);
    expect(target.children[0]).toBe(second.host);
    expect(shadowOf(second.host).querySelector('.dh-form-heading')?.textContent).toBe(
      'Leave a message',
    );
    // And no "already holds a form", because it does not: reporting that
    // while rendering nothing is the silent blank rectangle this whole
    // design is against.
    expect(onError).not.toHaveBeenCalled();

    second.destroy();
  });

  it('is idempotent on destroy', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootWithoutFormBlock()));
    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });

    mounted.destroy();
    expect(() => mounted.destroy()).not.toThrow();
    expect(target.children.length).toBe(0);
  });
});

describe('mountForm — the failure a visitor sees', () => {
  it('reads the boot route by header, with no cookie and no Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bootWithoutFormBlock());
    vi.stubGlobal('fetch', fetchMock);

    const mounted = mountForm(target, { apiUrl: `${API_URL}//`, publishableKey: PUBLISHABLE });
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBe(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}${FORM_BOOT_PATH}`);
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Publishable-Key']).toBe(PUBLISHABLE);
    expect(headers['Authorization']).toBeUndefined();
    expect(init.credentials).toBe('omit');

    mounted.destroy();
  });

  it('tells the visitor and takes Send away when the key is refused (401)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { error: { code: 'AUTH_INVALID' } }, { 'X-Request-ID': 'req-42' }),
      ),
    );
    const onError = vi.fn();

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError });
    const shadow = shadowOf(mounted.host);

    await vi.waitFor(() => {
      expect(shadow.querySelector('.dh-form-blocked')).not.toBeNull();
    });

    // The visitor's half: one plain sentence, no code, no request id.
    const notice = shadow.querySelector('.dh-form-blocked')!;
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toBe("We can't reach support from this page right now.");
    expect(notice.textContent).not.toContain('req-42');
    expect(notice.textContent).not.toContain('AUTH_INVALID');

    // Not a blank rectangle: what was being asked for is still on screen, and
    // anything already typed is still selectable.
    expect(shadow.querySelector('#dh-webform-message')).not.toBeNull();
    expect(shadow.querySelector<HTMLTextAreaElement>('#dh-webform-message')!.disabled).toBe(false);

    // Only Send is gone, because pressing it cannot succeed.
    const submit = shadow.querySelector<HTMLButtonElement>('.dh-form-submit')!;
    expect(submit.disabled).toBe(true);

    // The developer's half: the code and one id they can quote.
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    const lastCall = onError.mock.calls[onError.mock.calls.length - 1]!;
    const reported = lastCall[0] as {
      code?: string;
      requestId?: string;
      kind?: string;
    };
    expect(reported.kind).toBe('unauthorized');
    expect(reported.code).toBe('AUTH_INVALID');
    expect(reported.requestId).toBe('req-42');

    mounted.destroy();
  });

  it('takes Send away for an unlisted origin (403 ORIGIN_NOT_ALLOWED) too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: 'ORIGIN_NOT_ALLOWED' } })),
    );

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError: vi.fn() });
    const shadow = shadowOf(mounted.host);

    await vi.waitFor(() => expect(shadow.querySelector('.dh-form-blocked')).not.toBeNull());
    expect(shadow.querySelector<HTMLButtonElement>('.dh-form-submit')!.disabled).toBe(true);

    mounted.destroy();
  });

  // The state every chat-service deployed before this route existed is in:
  // the whole route is behind WEBFORM_ENDPOINT_ENABLED and is not mounted at
  // all when that is unset. Blocking on it would ship a form that is dead
  // everywhere until the server catches up.
  it.each([
    ['404, the route is not mounted', 404],
    ['429, throttled', 429],
    ['500, upstream is down', 500],
  ])('leaves the form fully usable on %s', async (_label, status) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, { error: { code: 'X' } }));
    vi.stubGlobal('fetch', fetchMock);

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError: vi.fn() });
    await flushBoot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const shadow = shadowOf(mounted.host);
    expect(shadow.querySelector('.dh-form-blocked')).toBeNull();
    expect(shadow.querySelector<HTMLButtonElement>('.dh-form-submit')!.disabled).toBe(false);

    mounted.destroy();
  });

  it('leaves the form fully usable when the network never answers', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError: vi.fn() });
    await flushBoot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const shadow = shadowOf(mounted.host);
    expect(shadow.querySelector('.dh-form-blocked')).toBeNull();
    expect(shadow.querySelector<HTMLButtonElement>('.dh-form-submit')!.disabled).toBe(false);

    mounted.destroy();
  });

  it('does not touch a destroyed form when the refusal lands after unmount', async () => {
    let settle: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending));
    const onError = vi.fn();

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError });
    const shadow = shadowOf(mounted.host);
    mounted.destroy();

    settle(jsonResponse(401, { error: { code: 'AUTH_INVALID' } }));
    // Two microtask turns is not the length of this chain — it is `await
    // fetch` → `await response.json()` → `.then(verdict …)`, and stopping
    // short of it asserts that a verdict which has not arrived has not
    // touched anything.
    await flushBoot();

    expect(shadow.querySelector('.dh-form-blocked')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  // The load-bearing assumption under every absence asserted above: that
  // `flushBoot()` outlasts the boot chain. Proved with the one verdict that
  // DOES leave a mark, and deliberately WITHOUT `vi.waitFor` — the notice has
  // to already be there the instant the flush returns. Without this, "the
  // notice is absent" and "the flush was too short" are the same green.
  it('flushBoot() outlasts the boot read, so an absence asserted after it is a real absence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'AUTH_INVALID' } })),
    );
    const onError = vi.fn();

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError });
    await flushBoot();

    expect(shadowOf(mounted.host).querySelector('.dh-form-blocked')).not.toBeNull();
    expect(onError).toHaveBeenCalled();

    mounted.destroy();
  });
});

describe('readFormBoot — the caller who has already gone', () => {
  // Exported for S2/S3/K6, so its realistic caller is a route component whose
  // effect settles after the unmount. By then the abort EVENT has already
  // fired, `addEventListener('abort', …)` never runs, and the internal
  // controller stays live unless the already-aborted state is read directly.
  it('hands fetch a signal that is already aborted when the caller\'s signal is', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      init.signal?.aborted === true
        ? Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
        : Promise.resolve(bootWithoutFormBlock()),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const gone = new AbortController();
    gone.abort();

    const verdict = await readFormBoot({
      apiUrl: API_URL,
      publishableKey: PUBLISHABLE,
      signal: gone.signal,
    });

    // What the platform is handed, which is what decides whether bytes leave
    // the machine — a stubbed `fetch` cannot show the request not being sent.
    expect(fetchMock.mock.calls[0]![1].signal?.aborted).toBe(true);
    // Still a verdict, never a throw: the contract is that this function has
    // no failure mode a caller has to catch.
    expect(verdict.kind).toBe('unknown');
  });

  it('still reads normally when the caller\'s signal is live', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      init.signal?.aborted === true
        ? Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
        : Promise.resolve(bootWithoutFormBlock()),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const live = new AbortController();
    const verdict = await readFormBoot({
      apiUrl: API_URL,
      publishableKey: PUBLISHABLE,
      signal: live.signal,
    });

    expect(fetchMock.mock.calls[0]![1].signal?.aborted).toBe(false);
    expect(verdict.kind).toBe('ok');
  });
});

describe('mountForm — the submission', () => {
  function fill(shadow: ShadowRoot): void {
    const email = shadow.querySelector<HTMLInputElement>('#dh-webform-email')!;
    const message = shadow.querySelector<HTMLTextAreaElement>('#dh-webform-message')!;
    email.value = 'ada@example.com';
    message.value = 'Where is my order?';
  }

  it('POSTs the draft to the existing webform path and confirms on a receipt', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith(WEBFORM_PATH)
        ? jsonResponse(202, { outcome: 'ticket', receiptId: 'r-1', duplicate: false, ticketRef: 'T-9' })
        : bootWithoutFormBlock(),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const onSubmitted = vi.fn();

    const mounted = mountForm(target, {
      apiUrl: API_URL,
      publishableKey: PUBLISHABLE,
      onError: vi.fn(),
      onSubmitted,
    });
    const shadow = shadowOf(mounted.host);
    fill(shadow);
    shadow.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const submitCall = calls.find(([url]) => url.endsWith(WEBFORM_PATH))!;
    const init = submitCall[1];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['email']).toBe('ada@example.com');
    expect(body['message']).toBe('Where is my order?');
    expect(body['prefer']).toBe('ticket');
    // The honeypot is always sent, and is empty for a human.
    expect(body['company_website']).toBe('');
    // An elapsed delta, never a wall-clock stamp.
    expect(typeof body['fillMs']).toBe('number');
    expect(body['fillMs'] as number).toBeLessThan(60_000);

    expect((onSubmitted.mock.calls[0]![0] as { receiptId: string }).receiptId).toBe('r-1');
    // The form is spent once sent: a confirmation, not a toast.
    await vi.waitFor(() => {
      expect(shadow.querySelector<HTMLElement>('.dh-offline-sent')!.hidden).toBe(false);
    });

    mounted.destroy();
  });

  it('keeps what the visitor typed and says one plain sentence when the submit fails', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith(WEBFORM_PATH)
        ? jsonResponse(429, { error: { code: 'RATE_LIMITED' } }, { 'Retry-After': '30' })
        : bootWithoutFormBlock(),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const onError = vi.fn();

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE, onError });
    const shadow = shadowOf(mounted.host);
    fill(shadow);
    shadow.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => {
      expect(shadow.querySelector<HTMLElement>('.dh-form-error')!.hidden).toBe(false);
    });

    expect(shadow.querySelector('.dh-form-error')!.textContent).toBe(
      'Too many messages from this page just now. Try again in a minute.',
    );
    // The dead-form bug this package exists to make unrepeatable.
    expect(shadow.querySelector<HTMLButtonElement>('.dh-form-submit')!.disabled).toBe(false);
    expect(shadow.querySelector<HTMLTextAreaElement>('#dh-webform-message')!.value).toBe(
      'Where is my order?',
    );

    mounted.destroy();
  });
});

describe('mountForm — the §14 key split', () => {
  it('refuses to mount with a secret key and leaves nothing on the page', () => {
    vi.stubGlobal('fetch', vi.fn());
    const secret = 'dhk_' + 'live_' + '0123456789abcdefghijklmn';

    expect(() => mountForm(target, { apiUrl: API_URL, publishableKey: secret })).toThrow();
    expect(target.children.length).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('agrees with core about what a secret key is, so the local list cannot drift', () => {
    // `form.ts` carries its own prefix test rather than importing `auth.ts`,
    // which would pull @dhaam-ccrm/core into dist/form.js. The prefixes have
    // already been renamed twice, so the drift is made LOUD here instead of
    // being merely unlikely.
    const cases = [
      'dhk_live_0123456789abcdefghijklmn',
      'dhsk_live_0123456789abcdefghijklmn',
      'sk_' + 'live_' + '0123456789abcdefghijklmn',
      'dhp_live_0123456789abcdefghijklmn',
      'dhp_test_0123456789abcdefghijklmn',
      'cus_123',
      '',
      'not-a-key-at-all',
    ];
    for (const value of cases) {
      expect([value, looksLikeSecretKeyLocal(value)]).toEqual([value, looksLikeSecretKey(value)]);
    }
  });
});

describe('mountForm — the caps the server publishes', () => {
  it('applies the published per-field limits as maxlength once the read lands', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bootWithoutFormBlock());
    vi.stubGlobal('fetch', fetchMock);

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    const shadow = shadowOf(mounted.host);

    // A name over 120 characters is a 400 from the submit route — discovered
    // AFTER the visitor has written out their whole problem. The caps exist
    // on the boot read precisely so it is an attribute instead.
    await vi.waitFor(() => {
      expect(shadow.querySelector<HTMLInputElement>('#dh-webform-name')!.maxLength).toBe(120);
    });
    expect(shadow.querySelector<HTMLInputElement>('#dh-webform-email')!.maxLength).toBe(320);
    expect(shadow.querySelector<HTMLInputElement>('#dh-webform-phone')!.maxLength).toBe(32);

    mounted.destroy();
  });

  it('leaves the built-in message cap alone when the read never lands', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(() => {})));

    const mounted = mountForm(target, { apiUrl: API_URL, publishableKey: PUBLISHABLE });
    const shadow = shadowOf(mounted.host);

    // `ui/webform-form.ts` sets this from WEBFORM_MESSAGE_MAX at build time,
    // so the cap that matters most is never waiting on a network call.
    expect(shadow.querySelector<HTMLTextAreaElement>('#dh-webform-message')!.maxLength).toBe(4000);

    mounted.destroy();
  });
});

describe('mountForm — the caller who got it wrong', () => {
  it('names the call rather than the DOM when the target is not an element', () => {
    vi.stubGlobal('fetch', vi.fn());
    // The realistic caller: a framework ref that has not attached yet.
    expect(() =>
      mountForm(null as unknown as Element, { apiUrl: API_URL, publishableKey: PUBLISHABLE }),
    ).toThrow(/element to mount into/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('names the field, never the value, when a credential is missing', () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(() => mountForm(target, { apiUrl: API_URL, publishableKey: '' })).toThrow(
      /publishableKey is required/,
    );
    expect(target.children.length).toBe(0);
  });
});
