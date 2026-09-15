// @vitest-environment jsdom
//
// `embedForm` — the iframe embed of the web form, from the MERCHANT's side.
//
// The merchant's page is the consumer here, and the two things it can be
// wrong about are the two things tested hardest: what the iframe is pointed
// at (K6's hosted page is built against that URL), and what the page does
// with a `message` event that arrives from anywhere else on the internet.
// jsdom computes no layout, so every height here is a value we post by hand;
// what is proved is the protocol, not the pixels.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMBED_MIN_HEIGHT_PX,
  FORM_RESIZE_MESSAGE_TYPE,
  bootEmbedsFromDocument,
  embedForm,
  installFormEmbedGlobal,
} from '../src/form-embed.js';
// Core's own answer, imported HERE and never in `src/form-embed.ts`: the test
// may carry @dhaam-ccrm/core, the bundle may not.
import { looksLikeSecretKey } from '../src/auth.js';

// Assembled at runtime, never a contiguous literal — a literal here blocks the
// push on secret scanning and trips a customer's scanner if they copy a test.
const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const HOSTED = 'https://console.example.com';

let target: HTMLElement;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  vi.restoreAllMocks();
  target.remove();
});

describe('embedForm — what the merchant page ends up pointing at', () => {
  it('creates one iframe whose src is the hosted page for this key, tagged with the embedder origin', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    expect(target.children.length).toBe(1);
    expect(target.children[0]).toBe(handle.iframe);
    expect(handle.iframe.tagName.toLowerCase()).toBe('iframe');

    // The contract K6's page is built against, byte for byte: path, then the
    // two query params, with the embedder's origin encoded so the frame can
    // postMessage back to exactly that origin and never to '*'.
    const src = new URL(handle.iframe.src);
    expect(src.origin).toBe(HOSTED);
    expect(src.pathname).toBe(`/f/${PUBLISHABLE}`);
    expect(src.searchParams.get('embed')).toBe('1');
    expect(src.searchParams.get('origin')).toBe(location.origin);
    expect(handle.iframe.src).toBe(
      `${HOSTED}/f/${encodeURIComponent(PUBLISHABLE)}?embed=1&origin=${encodeURIComponent(location.origin)}`,
    );

    handle.destroy();
  });

  it('URL-encodes the key rather than trusting its shape', () => {
    const odd = 'dhp_' + 'test_' + 'a/b?c#d';
    const handle = embedForm(target, { publishableKey: odd, hostedOrigin: HOSTED });

    expect(handle.iframe.src).toBe(
      `${HOSTED}/f/${encodeURIComponent(odd)}?embed=1&origin=${encodeURIComponent(location.origin)}`,
    );
    expect(new URL(handle.iframe.src).pathname).toBe(`/f/${encodeURIComponent(odd)}`);

    handle.destroy();
  });

  it('carries an accessible title, defaulting to "Contact form"', () => {
    const plain = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    expect(plain.iframe.title).toBe('Contact form');
    plain.destroy();

    const named = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED, title: 'Ask us' });
    expect(named.iframe.title).toBe('Ask us');
    named.destroy();
  });

  it('fills its container and never scrolls inside itself, at a sane height before the frame speaks', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    const { iframe } = handle;

    expect(iframe.style.width).toBe('100%');
    expect(iframe.style.height).toBe(`${EMBED_MIN_HEIGHT_PX}px`);
    expect(EMBED_MIN_HEIGHT_PX).toBeGreaterThan(0);
    // The only cross-browser way to switch the frame's OWN scrollbar off is
    // the attribute; `overflow` on the element is what the CSS side needs.
    expect(iframe.getAttribute('scrolling')).toBe('no');
    expect(iframe.style.overflow).toBe('hidden');
    expect(iframe.style.border).toBe('0px');

    handle.destroy();
  });
});

describe('embedForm — what it refuses', () => {
  it.each([
    ['a trailing slash', `${HOSTED}/`],
    ['a path', `${HOSTED}/f`],
    ['a query', `${HOSTED}?x=1`],
    ['a default port spelled out', 'https://console.example.com:443'],
    ['a bare host', 'console.example.com'],
    ['an opaque origin', 'null'],
    ['a wildcard', '*'],
    ['the empty string', ''],
    // `new URL(x).origin === x` holds for these — they are canonical origins,
    // just not ones an `<iframe>` can ever load. Without a scheme test they
    // are accepted and produce a permanently empty box: the frame never
    // navigates, so it never posts a height, so nothing anywhere says why.
    ['a websocket scheme', 'ws://console.example.com'],
    ['a secure websocket scheme', 'wss://console.example.com'],
    ['a non-web scheme', 'ftp://console.example.com'],
    // Already impossible — `new URL('javascript:…').origin` is the string
    // `"null"`, so the canonical test rejects it — and pinned here anyway,
    // because "already impossible" is a property of `URL`, not of this file.
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<form>'],
  ])('rejects hostedOrigin with %s, so the origin check can be an equality', (_label, hostedOrigin) => {
    expect(() => embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin })).toThrow(/hostedOrigin/);
    expect(target.children.length).toBe(0);
  });

  it('accepts a non-default port and http for local development', () => {
    const local = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: 'http://localhost:4599' });
    expect(new URL(local.iframe.src).origin).toBe('http://localhost:4599');
    local.destroy();
  });

  it('names the call rather than the DOM when the target is not an element', () => {
    expect(() =>
      embedForm(null as unknown as Element, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED }),
    ).toThrow(/element to embed into/);
  });

  it('names the field, never the value, when the key is missing', () => {
    expect(() => embedForm(target, { publishableKey: '', hostedOrigin: HOSTED })).toThrow(
      /publishableKey is required/,
    );
    expect(target.children.length).toBe(0);
  });

  it('refuses a secret key and leaves nothing on the page, because the key goes into a URL', () => {
    const secret = 'dhk_' + 'live_' + '0123456789abcdefghijklmn';
    let thrown: unknown = null;
    try {
      embedForm(target, { publishableKey: secret, hostedOrigin: HOSTED });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    // The message names the problem, not the credential.
    expect(String((thrown as Error).message)).not.toContain(secret);
    expect(target.children.length).toBe(0);
  });
});

describe('embedForm — destroy and the caller who has already gone', () => {
  it('removes the iframe on destroy, idempotently', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    handle.destroy();
    expect(target.children.length).toBe(0);
    expect(() => handle.destroy()).not.toThrow();
  });

  it('tears down when a live signal aborts', () => {
    const controller = new AbortController();
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED, signal: controller.signal });
    expect(target.children.length).toBe(1);

    controller.abort();
    expect(target.children.length).toBe(0);
    expect(handle.iframe.isConnected).toBe(false);
  });

  it('never enters the document when the signal is already aborted', () => {
    const gone = new AbortController();
    gone.abort();
    const addListener = vi.spyOn(window, 'addEventListener');

    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED, signal: gone.signal });

    // Still a handle, never a throw: this is a route component's ordinary
    // unmounted-before-the-effect-settled case, not its edge case.
    expect(handle.iframe).toBeInstanceOf(HTMLIFrameElement);
    expect(target.children.length).toBe(0);
    expect(addListener.mock.calls.some(([type]) => type === 'message')).toBe(false);
    expect(() => handle.destroy()).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The height protocol, from the host's side.
//
// Every `message` event on a page is broadcast to every listener on it, so
// the assertions below are mostly about what is IGNORED: another embed's
// frame, another document on the same console host, a lookalike origin, and
// a payload that says the right word with the wrong number in it.
// ══════════════════════════════════════════════════════════════════════════

/** A `message` event as the platform delivers it, with a settable `source`. */
function postToHost(source: Window | null, origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { origin, source, data }));
}

function resize(height: unknown): unknown {
  return { type: FORM_RESIZE_MESSAGE_TYPE, height };
}

describe('embedForm — the height protocol', () => {
  it('grows the frame to a height its own page reports', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    postToHost(handle.iframe.contentWindow, HOSTED, resize(742));

    expect(handle.iframe.style.height).toBe('742px');
    handle.destroy();
  });

  it('takes a fractional height up, never down — a rounded-down frame clips its last line', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    postToHost(handle.iframe.contentWindow, HOSTED, resize(742.2));

    expect(handle.iframe.style.height).toBe('743px');
    handle.destroy();
  });

  it('SHRINKS below the starting height, which is a default and not a floor', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    expect(handle.iframe.style.height).toBe(`${EMBED_MIN_HEIGHT_PX}px`);

    // The submitted state is a two-line confirmation. Clamping at the initial
    // height would leave a merchant's page with 200px of empty iframe under
    // it for the rest of the visit.
    postToHost(handle.iframe.contentWindow, HOSTED, resize(120));

    expect(handle.iframe.style.height).toBe('120px');
    handle.destroy();
  });

  it('keeps tracking, message after message', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    postToHost(handle.iframe.contentWindow, HOSTED, resize(500));
    postToHost(handle.iframe.contentWindow, HOSTED, resize(880));
    postToHost(handle.iframe.contentWindow, HOSTED, resize(300));

    expect(handle.iframe.style.height).toBe('300px');
    handle.destroy();
  });

  it('never speaks to the frame: the protocol is one-way, frame → host', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    const frame = handle.iframe.contentWindow!;
    const post = vi.spyOn(frame, 'postMessage');

    postToHost(frame, HOSTED, resize(742));
    handle.destroy();

    // Nothing is ever posted host → frame, so the hosted page needs no
    // listener and no origin check of its own for us.
    expect(post).not.toHaveBeenCalled();
  });
});

describe('embedForm — the postMessage traffic it refuses', () => {
  it('ignores a resize from an origin that is not the hosted one', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    // A lookalike, a subdomain, and the embedding page itself — all of which
    // can post to this window, and none of which is the frame we created.
    postToHost(handle.iframe.contentWindow, 'https://console.example.com.evil.test', resize(9000));
    postToHost(handle.iframe.contentWindow, 'https://evil.console.example.com', resize(9000));
    postToHost(handle.iframe.contentWindow, location.origin, resize(9000));
    postToHost(handle.iframe.contentWindow, 'null', resize(9000));

    expect(handle.iframe.style.height).toBe(`${EMBED_MIN_HEIGHT_PX}px`);
    handle.destroy();
  });

  it('ignores a resize from the RIGHT origin but a different window', () => {
    const first = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    const other = document.createElement('div');
    document.body.appendChild(other);
    const second = embedForm(other, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    // Two embeds of the same hosted page on one merchant page — a contact
    // block and a footer. Origin alone cannot tell them apart, so without the
    // source check the footer's height lands on the contact block.
    postToHost(second.iframe.contentWindow, HOSTED, resize(880));

    expect(first.iframe.style.height).toBe(`${EMBED_MIN_HEIGHT_PX}px`);
    expect(second.iframe.style.height).toBe('880px');

    first.destroy();
    second.destroy();
    other.remove();
  });

  it('ignores a resize with no source at all', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    postToHost(null, HOSTED, resize(880));

    expect(handle.iframe.style.height).toBe(`${EMBED_MIN_HEIGHT_PX}px`);
    handle.destroy();
  });

  it.each([
    ['no payload', null],
    ['a string payload', 'dhaam-form:resize'],
    ['a number payload', 742],
    ['an array payload', [{ type: 'dhaam-form:resize', height: 742 }]],
    ['another product on the same host', { type: 'other-widget:resize', height: 742 }],
    ['our type with no height', { type: 'dhaam-form:resize' }],
    ['a height as a string', { type: 'dhaam-form:resize', height: '742' }],
    ['a NaN height', { type: 'dhaam-form:resize', height: Number.NaN }],
    ['an infinite height', { type: 'dhaam-form:resize', height: Number.POSITIVE_INFINITY }],
    ['a negative height', { type: 'dhaam-form:resize', height: -1 }],
    ['a null height', { type: 'dhaam-form:resize', height: null }],
  ])('ignores %s, even from our own frame on the right origin', (_label, payload) => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    postToHost(handle.iframe.contentWindow, HOSTED, payload);

    expect(handle.iframe.style.height).toBe(`${EMBED_MIN_HEIGHT_PX}px`);
    handle.destroy();
  });

  it('says nothing to the console about any of it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    // A page carrying two of our embeds, a Stripe frame and an intercom frame
    // sees all of their traffic. Reporting it would print a line per message
    // per embed, which trains an integrator to ignore our console output.
    postToHost(handle.iframe.contentWindow, 'https://js.stripe.com', { type: 'stripe', height: 1 });
    postToHost(null, HOSTED, resize(880));
    postToHost(handle.iframe.contentWindow, HOSTED, { type: 'dhaam-form:resize' });

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('stops listening once destroyed, and leaves no listener on the window', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    const frame = handle.iframe.contentWindow;

    handle.destroy();
    postToHost(frame, HOSTED, resize(880));

    expect(handle.iframe.style.height).toBe(`${EMBED_MIN_HEIGHT_PX}px`);
    // Released rather than merely guarded: a listener left on the window
    // holds this closure — and the detached iframe in it — for the life of
    // the page, on a page that may mount and unmount the form repeatedly.
    expect(remove.mock.calls.some(([type]) => type === 'message')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The frame that never speaks.
//
// The most likely thing to go wrong in production is not a hostile message —
// it is a hosted page that never loads at all: a typo'd `hostedOrigin`, a
// route behind `X-Frame-Options: SAMEORIGIN`, a console that is down. Rule 3
// is silent BY DESIGN, so without the signal below that failure has no
// observable anywhere: an empty 320px box and nothing in any console.
// ══════════════════════════════════════════════════════════════════════════

describe('embedForm — when the frame never speaks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onUnreachable once, after a grace period, and prints nothing', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onUnreachable = vi.fn();

    const handle = embedForm(target, {
      publishableKey: PUBLISHABLE,
      hostedOrigin: HOSTED,
      onUnreachable,
    });

    // Not trigger-happy: a slow hosted page on a slow connection is not an
    // unreachable one, and a false positive here fires a merchant's fallback
    // over a form that was about to appear.
    vi.advanceTimersByTime(5_000);
    expect(onUnreachable).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(onUnreachable).toHaveBeenCalledTimes(1);

    // Silent BY DEFAULT is the whole reason this is a callback and not a
    // `console.warn`: the `message` channel is shared, and a line here would
    // print on every page that carries a second product's frame.
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    // Once for the embed, not once per interval.
    vi.advanceTimersByTime(120_000);
    expect(onUnreachable).toHaveBeenCalledTimes(1);

    handle.destroy();
  });

  it('stays quiet once the frame has reported a height', () => {
    vi.useFakeTimers();
    const onUnreachable = vi.fn();

    const handle = embedForm(target, {
      publishableKey: PUBLISHABLE,
      hostedOrigin: HOSTED,
      onUnreachable,
    });
    postToHost(handle.iframe.contentWindow, HOSTED, resize(742));
    vi.advanceTimersByTime(120_000);

    expect(onUnreachable).not.toHaveBeenCalled();
    expect(handle.iframe.style.height).toBe('742px');
    handle.destroy();
  });

  it('counts only messages it ACCEPTED — a lookalike origin is not the frame', () => {
    vi.useFakeTimers();
    const onUnreachable = vi.fn();

    const handle = embedForm(target, {
      publishableKey: PUBLISHABLE,
      hostedOrigin: HOSTED,
      onUnreachable,
    });
    // Everything rule 3 throws away: another origin, another window, our
    // type with an unusable height. None of these is our page speaking, so
    // none of them may silence the one signal that says so.
    postToHost(handle.iframe.contentWindow, 'https://console.example.com.evil.test', resize(742));
    postToHost(null, HOSTED, resize(742));
    postToHost(handle.iframe.contentWindow, HOSTED, resize('742'));
    vi.advanceTimersByTime(120_000);

    expect(onUnreachable).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it.each([
    ['destroy()', (handle: { destroy(): void }) => handle.destroy()],
    ['an aborting signal', null],
  ])('never fires after %s took the embed off the page', (_label, teardown) => {
    vi.useFakeTimers();
    const onUnreachable = vi.fn();
    const controller = new AbortController();

    const handle = embedForm(target, {
      publishableKey: PUBLISHABLE,
      hostedOrigin: HOSTED,
      signal: controller.signal,
      onUnreachable,
    });
    if (teardown === null) controller.abort();
    else teardown(handle);
    vi.advanceTimersByTime(120_000);

    // A torn-down embed is not an unreachable one — the caller already knows
    // where it went, and a route component that unmounts mid-load would
    // otherwise fire a merchant's error path on every navigation.
    expect(onUnreachable).not.toHaveBeenCalled();
  });

  it('leaves no timer behind for a caller who passed no callback', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    // No callback, so nothing to schedule: the default is not "a quiet
    // timer", it is no timer.
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(120_000);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    handle.destroy();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The strict-CSP claim, asserted rather than promised.
//
// The merchant's page grants `frame-src <hostedOrigin>` and NOTHING else —
// in particular not `style-src 'unsafe-inline'`. That holds only while every
// style goes through the CSSOM property setters, which CSP does not govern.
// A `setAttribute('style', …)` or an injected `<style>` element would each
// need that grant, so both are asserted against here: the regression is one
// convenient line away and is invisible in jsdom, which applies no policy.
// ══════════════════════════════════════════════════════════════════════════

describe('embedForm — under a strict host CSP', () => {
  // Belt and braces: the `script-src` test below stubs `Function` and `eval`,
  // and an assertion failing before its own `unstubAllGlobals()` would leave
  // them stubbed for every test after it — a cascade that hides the one real
  // failure. `restoreAllMocks` in the outer hook does not undo a stub.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets no style attribute and injects no <style> element', () => {
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
    const createElement = vi.spyOn(document, 'createElement');
    const stylesBefore = document.querySelectorAll('style').length;

    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    postToHost(handle.iframe.contentWindow, HOSTED, resize(742));

    // `style-src 'unsafe-inline'` covers the style ATTRIBUTE as well as
    // `<style>`; the CSSOM property setters are outside CSP entirely, which
    // is the whole reason this file uses them.
    expect(setAttribute.mock.calls.filter(([name]) => name === 'style')).toEqual([]);
    expect(createElement.mock.calls.filter(([tag]) => String(tag).toLowerCase() === 'style')).toEqual([]);
    expect(document.querySelectorAll('style').length).toBe(stylesBefore);

    // And the height still got there, so this is not vacuously true.
    expect(handle.iframe.style.height).toBe('742px');

    handle.destroy();
  });

  it('navigates the frame by src and never by srcdoc, so it does not inherit this page\'s policy', () => {
    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });

    // The one genuinely CSP-relevant way to get this wrong. A `srcdoc` frame
    // inherits the EMBEDDER's policy rather than the console's, so the
    // "frame-src and nothing else" claim above would stop being true: the
    // document's own scripts and styles would then be judged against the
    // merchant's `script-src` and `style-src`. It would also give the frame
    // the embedder's origin, which quietly collapses rule 3(a).
    expect(handle.iframe.getAttribute('srcdoc')).toBeNull();
    expect(handle.iframe.srcdoc).toBe('');
    expect(new URL(handle.iframe.src).origin).toBe(HOSTED);
    expect(handle.iframe.getAttribute('src')).not.toBe('');

    handle.destroy();
  });

  it('evaluates nothing and fetches nothing — no new script-src or connect-src grant needed', () => {
    const fetchMock = vi.fn();
    const evalMock = vi.fn();
    const writeMock = vi.spyOn(document, 'write').mockImplementation(() => {});
    const writelnMock = vi.spyOn(document, 'writeln').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);
    // The three routes a strict `script-src` is actually about. The title
    // used to say "evaluates nothing" while asserting only `fetch`; these are
    // what make the first half of it mean something.
    vi.stubGlobal('eval', evalMock);
    const FunctionSpy = vi.fn();
    vi.stubGlobal('Function', FunctionSpy);

    const handle = embedForm(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    postToHost(handle.iframe.contentWindow, HOSTED, resize(742));
    // The height arrived, so none of this is vacuous.
    expect(handle.iframe.style.height).toBe('742px');
    handle.destroy();

    // The page inside the frame does its own reading, under the CONSOLE
    // host's policy. This side of the boundary makes no request at all.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(evalMock).not.toHaveBeenCalled();
    expect(FunctionSpy).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
    expect(writelnMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The `<script src="…/form-embed.js">` half.
//
// Bundled by `scripts/bundle.mjs`, which supplies a two-line entry calling
// `installFormEmbedGlobal()`. The entry lives in the build script because
// auto-installing a global and scanning the document are properties of THAT
// ARTIFACT and not of the module — a React app importing `embedForm` must get
// neither — so the logic is here, where a test can reach it.
// ══════════════════════════════════════════════════════════════════════════

/** A script tag exactly as a merchant pastes it, plus its mount target. */
function scriptTag(attrs: Record<string, string>): HTMLScriptElement {
  const script = document.createElement('script');
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
  document.head.appendChild(script);
  return script;
}

describe('the script-tag half', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['DhaamFormEmbed'];
    for (const script of document.querySelectorAll('script[data-publishable-key]')) script.remove();
  });

  it('embeds into every element the tag points at, defaulting to [data-dhaam-form]', () => {
    scriptTag({ 'data-publishable-key': PUBLISHABLE, 'data-hosted-origin': HOSTED });
    const first = document.createElement('div');
    first.setAttribute('data-dhaam-form', '');
    const second = document.createElement('div');
    second.setAttribute('data-dhaam-form', '');
    target.append(first, second);

    bootEmbedsFromDocument();

    expect(first.querySelector('iframe')).not.toBeNull();
    expect(second.querySelector('iframe')).not.toBeNull();
    expect(first.querySelector('iframe')!.src).toBe(
      `${HOSTED}/f/${encodeURIComponent(PUBLISHABLE)}?embed=1&origin=${encodeURIComponent(location.origin)}`,
    );
  });

  it('honours data-target and data-title', () => {
    scriptTag({
      'data-publishable-key': PUBLISHABLE,
      'data-hosted-origin': HOSTED,
      'data-target': '#contact-form',
      'data-title': 'Message our team',
    });
    const slot = document.createElement('div');
    slot.id = 'contact-form';
    target.appendChild(slot);

    bootEmbedsFromDocument();

    expect(slot.querySelector('iframe')!.title).toBe('Message our team');
  });

  it.each([
    ['data-auto="false"', { 'data-auto': 'false' }],
    ['no hosted origin — an API-only include', { 'data-hosted-origin': '' }],
  ])('mounts nothing, silently, for %s', (_label, overrides) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    scriptTag({ 'data-publishable-key': PUBLISHABLE, 'data-hosted-origin': HOSTED, ...overrides });
    const slot = document.createElement('div');
    slot.setAttribute('data-dhaam-form', '');
    target.appendChild(slot);

    bootEmbedsFromDocument();

    expect(slot.querySelector('iframe')).toBeNull();
    // Silent: including this file for the API and embedding by hand is a
    // legitimate way to use it, and warning would train integrators to ignore
    // our console output.
    expect(error).not.toHaveBeenCalled();
  });

  it('reports a bad tag rather than throwing into the merchant page load', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    scriptTag({ 'data-publishable-key': PUBLISHABLE, 'data-hosted-origin': `${HOSTED}/oops/` });
    const slot = document.createElement('div');
    slot.setAttribute('data-dhaam-form', '');
    target.appendChild(slot);

    expect(() => bootEmbedsFromDocument()).not.toThrow();
    expect(slot.querySelector('iframe')).toBeNull();
    expect(error).toHaveBeenCalled();
    // The diagnostic carries the error object and no key.
    expect(JSON.stringify(error.mock.calls)).not.toContain(PUBLISHABLE);
  });

  it('installs window.DhaamFormEmbed and never replaces one that is already there', () => {
    const theirs = { embed: () => undefined };
    const store = window as unknown as Record<string, unknown>;
    store['DhaamFormEmbed'] = theirs;

    installFormEmbedGlobal();
    expect(store['DhaamFormEmbed']).toBe(theirs);

    delete store['DhaamFormEmbed'];
    installFormEmbedGlobal();
    const api = store['DhaamFormEmbed'] as { embed: typeof embedForm };
    expect(typeof api.embed).toBe('function');

    const handle = api.embed(target, { publishableKey: PUBLISHABLE, hostedOrigin: HOSTED });
    expect(target.querySelector('iframe')).toBe(handle.iframe);
    handle.destroy();
  });
});

describe('embedForm — the §14 key split, and the format it does NOT enforce', () => {
  it('agrees with core about what a secret key is, so the local list cannot drift', () => {
    // This file carries its own prefix test rather than importing `auth.ts`,
    // which would pull @dhaam-ccrm/core into dist/form-embed.js. The prefixes
    // have been renamed twice already, so the drift is made LOUD here.
    const cases = [
      'dhk_live_0123456789abcdefghijklmn',
      'dhsk_live_0123456789abcdefghijklmn',
      'sk_' + 'live_' + '0123456789abcdefghijklmn',
      '  dhk_live_0123456789abcdefghijklmn  ',
      'DHK_LIVE_0123456789ABCDEFGHIJKLMN',
      'dhp_live_0123456789abcdefghijklmn',
      'dhpk_live_0123456789abcdefghijklmn',
      'cus_123',
      '',
      'not-a-key-at-all',
    ];
    for (const value of cases) {
      let refused = false;
      try {
        embedForm(target, { publishableKey: value, hostedOrigin: HOSTED });
      } catch (error) {
        refused = String((error as Error).message).includes('secret key');
      }
      document.querySelectorAll('iframe').forEach((frame) => frame.remove());
      expect([value, refused]).toEqual([value, looksLikeSecretKey(value)]);
    }
  });

  it.each([
    ['dhp_live_', 'dhp_' + 'live_' + '0123456789abcdefghijklmn'],
    ['dhp_test_', 'dhp_' + 'test_' + '0123456789abcdefghijklmn'],
    // The retired spelling core still accepts, and the one chat-service-node's
    // customer auth middleware documents on the wire.
    ['dhpk_live_', 'dhpk_' + 'live_' + '0123456789abcdefghijklmn'],
    ['dhpk_test_', 'dhpk_' + 'test_' + '0123456789abcdefghijklmn'],
  ])('says nothing about a %s key', (_label, publishableKey) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const handle = embedForm(target, { publishableKey, hostedOrigin: HOSTED });

    expect(warn).not.toHaveBeenCalled();
    expect(new URL(handle.iframe.src).pathname).toBe(`/f/${publishableKey}`);
    handle.destroy();
  });

  it('WARNS about an unrecognised prefix ONCE FOR THE PAGE and embeds anyway — the server is the authority', async () => {
    // A FRESH instance of the module, deliberately. "Once" is module state,
    // and the loop above has already spent this file's one warning on
    // `cus_123`, so a statically imported `embedForm` would warn zero times
    // here and this test would pass for the wrong reason.
    vi.resetModules();
    const fresh = await import('../src/form-embed.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const future = 'dhx_' + 'live_' + '0123456789abcdefghijklmn';

    // Two hand-written embeds — a contact block and a footer, the same page
    // shape the source check in the height protocol exists for.
    const first = fresh.embedForm(target, { publishableKey: future, hostedOrigin: HOSTED });
    const second = fresh.embedForm(target, { publishableKey: future, hostedOrigin: HOSTED });

    // And the script-tag path across three slots, which is the shape that
    // multiplies fastest: ONE tag, ONE key, one warning per slot found.
    scriptTag({ 'data-publishable-key': future, 'data-hosted-origin': HOSTED });
    const slots = [0, 1, 2].map(() => {
      const slot = document.createElement('div');
      slot.setAttribute('data-dhaam-form', '');
      target.appendChild(slot);
      return slot;
    });
    fresh.bootEmbedsFromDocument();

    // ONE line for five embeds of one key. Repeated identical console output
    // is exactly how an integrator learns to filter our prefix out entirely,
    // which costs us the next warning — the one that matters.
    expect(warn).toHaveBeenCalledTimes(1);

    // Advisory, never a throw: every one of the five is on the page. A
    // publishable key is baked into pages that ship to every visitor and
    // cannot be redeployed on our schedule, and a format list this package
    // has already renamed twice is not a good enough reason to take a
    // merchant's contact form off the air.
    expect(first.iframe.isConnected).toBe(true);
    expect(second.iframe.isConnected).toBe(true);
    expect(new URL(first.iframe.src).pathname).toBe(`/f/${future}`);
    for (const slot of slots) expect(slot.querySelector('iframe')).not.toBeNull();

    // The warning names the field and the expected prefixes, never the value.
    expect(JSON.stringify(warn.mock.calls)).not.toContain(future);

    first.destroy();
    second.destroy();
    for (const script of document.querySelectorAll('script[data-publishable-key]')) script.remove();
  });
});
