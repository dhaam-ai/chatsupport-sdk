// @vitest-environment node
//
// Deliberately the 'node' vitest environment, for the reason ssr.test.ts and
// dom-hooks-ssr.test.ts give: a jsdom-backed test would pass here for the
// wrong reason. `<DhaamForm>` wraps a module whose whole job is to put
// elements in a document, so a stray `window`/`document` read at import time
// or during render is exactly the mistake this file exists to catch — and
// against jsdom it would quietly find a fake one and succeed.
//
// A separate file rather than a case appended to ssr.test.ts because the
// environment pragma above is per FILE, and because this one imports the
// package barrel (and through it @dhaam-ccrm/widget) rather than a single
// hook module: a Next.js server component importing `@dhaam-ccrm/react` pulls
// in everything the barrel names, which is the thing worth proving safe.

import { describe, expect, it } from 'vitest';

import { renderToStaticMarkup } from 'react-dom/server';

import { DhaamForm } from '../src/index.js';
import { h } from './h.js';

const PUBLISHABLE = 'dhp_' + 'test_' + '0123456789abcdefghijklmn';
const API_URL = 'https://chat.example.com';

describe('<DhaamForm> under server rendering', () => {
  it('this file genuinely has no DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders its host element with no window/document present', () => {
    const html = renderToStaticMarkup(
      h(DhaamForm, { apiUrl: API_URL, publishableKey: PUBLISHABLE, className: 'contact-form' }),
    );

    // The host, and only the host. The form itself arrives in an effect, which
    // never runs on a server — so the server's markup is an empty box the
    // client fills in, not a half-built form the hydration has to reconcile.
    expect(html).toBe('<div class="contact-form"></div>');
  });

  it('renders without a className too', () => {
    expect(renderToStaticMarkup(h(DhaamForm, { apiUrl: API_URL, publishableKey: PUBLISHABLE }))).toBe('<div></div>');
  });

  it('does not reach the key check during a server render', () => {
    // `mountForm` throws on a secret key, and a server render must not be
    // where that happens: a build-time or server-side crash for a bad key
    // would take down a whole page render, and the check belongs on the
    // client where the credential would actually have been exposed.
    expect(() =>
      renderToStaticMarkup(h(DhaamForm, { apiUrl: API_URL, publishableKey: 'dhk_' + 'live_0123456789abcdef' })),
    ).not.toThrow();
  });
});
