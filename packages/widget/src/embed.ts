// The script-tag entry point. This is the file that makes the product owner's
// sentence true: "whenever any frontend uses or invokes this SDK, a chat
// floating icon auto comes".
//
//   <script src="https://cdn…/widget.js"
//           data-publishable-key="dhp_live_…"
//           data-token-endpoint="/api/chat-token"
//           data-user-id="cus_123"
//           data-api-url="https://chat.example.com"
//           data-ws-url="wss://chat.example.com"
//           data-mode="bubble"></script>
//
// No build step, no framework, no `window.onload` handler for the integrator
// to write.
//
// ── Nothing here is allowed to break the host page ──────────────────────
//
// Every entry into this module is wrapped, and the failure path is a single
// `console.error`. That is not defensive habit; it is the contract. The script
// tag sits in someone's checkout page, frequently in `<head>`, and an
// exception thrown while it evaluates is an exception in THEIR page load —
// blocking their own scripts if it is synchronous, and landing in their error
// tracker as a defect in their product either way. A widget that fails to
// appear is a support ticket. A widget that takes the page down is an outage.

import { configFromAttributes } from './attributes.js';
import { getWidget, mount } from './index.js';
import type { ChatWidget } from './widget.js';
import type { WidgetConfig } from './config.js';

/** The API a `<script>`-tag integrator gets, on `window.DhaamChat`. */
export interface DhaamChatGlobal {
  mount(config: WidgetConfig): ChatWidget;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
  /** The mounted widget, or `null` — the escape hatch to `store.client`. */
  widget(): ChatWidget | null;
}

function report(error: unknown): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    // The error object, never a config value. `configFromAttributes` throws
    // `SecretKeyInClientError` on a pasted secret, and this line must not be
    // the thing that then prints it into a shared browser console — core's
    // error classes carry no input for exactly this reason.
    console.error('[@dhaam-ccrm/widget] failed to start', error);
  }
}

/**
 * The tag that loaded us.
 *
 * `document.currentScript` is correct only while the script evaluates
 * synchronously, and is `null` for a module script or one appended by a
 * loader. The fallback finds our tag by a marker attribute rather than by
 * `src`, because a CDN, a proxy, or a tag manager will each rewrite the URL,
 * and a `src.includes('widget.js')` test would then find nothing.
 */
function locateScript(): HTMLElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLElement) return current;
  return document.querySelector<HTMLElement>('script[data-publishable-key]');
}

function install(): void {
  const api: DhaamChatGlobal = {
    mount,
    open: () => getWidget()?.open(),
    close: () => getWidget()?.close(),
    toggle: () => getWidget()?.toggle(),
    destroy: () => getWidget()?.destroy(),
    widget: getWidget,
  };

  // Not overwritten if present: a second copy of this bundle must not swap out
  // the API object the host may already hold a reference to. `??=` is the
  // whole double-load story at this level; the widget itself is guarded
  // separately in singleton.ts, because the two can fail independently.
  const target = window as unknown as Record<string, unknown>;
  target['DhaamChat'] ??= api;
}

function boot(): void {
  const script = locateScript();
  if (script === null) return;

  // An explicit opt-out for hosts that want the API but want to choose the
  // moment and the config themselves — a marketplace that mounts only once an
  // order is live, say.
  if (script.dataset['auto'] === 'false') return;

  // No key on the tag means this is a plain API include, not an auto-mount.
  // Silent, because that is a legitimate way to use this file, and warning
  // about it would train integrators to ignore our console output.
  if (script.dataset['publishableKey'] === undefined) return;

  mount(configFromAttributes(script.dataset));
}

/**
 * Runs once the document has a `<body>` to append to.
 *
 * A tag in `<head>` — where performance advice puts async scripts — evaluates
 * before `document.body` exists, and ui/root.ts would then append the host
 * element to `<html>`. That works, but it also means the widget paints before
 * the page it sits on. Waiting for `DOMContentLoaded` in that one case costs
 * nothing (the panel is closed anyway) and keeps the launcher from flashing
 * over an empty page.
 */
function whenReady(run: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try {
        run();
      } catch (error) {
        report(error);
      }
    }, { once: true });
    return;
  }
  run();
}

try {
  install();
  whenReady(boot);
} catch (error) {
  report(error);
}
