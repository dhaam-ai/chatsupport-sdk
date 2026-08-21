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
import type { ChatEventHandler, ChatEventName, Unsubscribe } from '@dhaam-ccrm/js';

/** The API a `<script>`-tag integrator gets, on `window.DhaamChat`. */
export interface DhaamChatGlobal {
  mount(config: WidgetConfig): ChatWidget;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;

  /**
   * Subscribes to core's §6.5 event catalog. Returns an unsubscribe.
   *
   *     DhaamChat.on('conversationStarted', () => DhaamChat.open());
   *
   * The whole catalog rather than a hand-picked subset, so this method never
   * needs extending again — and one method rather than a callback slot per
   * event, so a host adds a listener the same way whatever they listen for.
   *
   * ── Order-independent, which is the point ────────────────────────────
   *
   * A `<script>` tag mounts on `DOMContentLoaded`, so the obvious host code —
   * our tag, then an inline `<script>` that calls this — runs BEFORE any
   * widget exists. Reaching through `widget()` there returns `null` and drops
   * the subscription on the floor, which is exactly the trap this method
   * exists to remove. Registrations are held and attached at mount, and
   * re-attached if the widget is destroyed and mounted again, so a handler
   * registered once stays live for whatever widget is on the page.
   */
  on<E extends ChatEventName>(event: E, handler: ChatEventHandler<E>): Unsubscribe;

  /** The mounted widget, or `null` — the escape hatch to `store.client`. */
  widget(): ChatWidget | null;
}

/**
 * A host registration, plus its live subscription to the current widget.
 *
 * `release` is null whenever nothing is mounted — before the first mount, and
 * after a `destroy()` — which is the state the whole buffer exists to survive.
 */
interface Registration {
  readonly event: ChatEventName;
  readonly handler: ChatEventHandler<ChatEventName>;
  release: Unsubscribe | null;
}

const registrations = new Set<Registration>();

/**
 * The widget the registrations are currently bound to.
 *
 * Compared by IDENTITY, not by "is something mounted". A host can tear a
 * widget down without going through `DhaamChat.destroy()` — `widget()
 * .destroy()` and the `mount`/`unmount` module exports both do it — and the
 * next mount then produces a DIFFERENT widget with a different store. Without
 * an identity check the registrations would still be holding releases for the
 * dead one, look attached, and never re-bind.
 */
let attachedTo: ChatWidget | null = null;

function attach(registration: Registration, widget: ChatWidget): void {
  try {
    registration.release = widget.store.on(registration.event, registration.handler);
  } catch (error) {
    // Subscribing is not supposed to be able to fail, but this file's contract
    // is that nothing it does reaches the host page as an exception.
    report(error);
  }
}

function detach(registration: Registration): void {
  try {
    registration.release?.();
  } catch {
    // A store torn down before us has already dropped every listener it held,
    // so failing to release one is not news and must not be reported as such.
  }
  registration.release = null;
}

/** Binds every registration to `widget`, rebinding if it is a new one. */
function attachAll(widget: ChatWidget): void {
  if (attachedTo === widget) return;
  attachedTo = widget;
  for (const registration of registrations) {
    detach(registration);
    attach(registration, widget);
  }
}

function detachAll(): void {
  attachedTo = null;
  for (const registration of registrations) detach(registration);
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

/**
 * The one funnel every mount on this API goes through.
 *
 * Both `DhaamChat.mount(…)` and the script tag's own auto-boot land here, so
 * there is no path that mounts a widget without attaching the registrations
 * waiting for it. `mount()` is itself idempotent (singleton.ts), and attaching
 * is guarded on `release` being null, so a second call adds no duplicates.
 */
function mountAndAttach(config: WidgetConfig): ChatWidget {
  const widget = mount(config);
  attachAll(widget);
  return widget;
}

function install(): void {
  const api: DhaamChatGlobal = {
    mount: mountAndAttach,
    open: () => getWidget()?.open(),
    close: () => getWidget()?.close(),
    toggle: () => getWidget()?.toggle(),
    destroy: () => {
      // Released BEFORE the teardown that would invalidate them, but the
      // registrations themselves are kept: a host that subscribed once and
      // then remounted must not have to subscribe again, which is the same
      // promise `on` makes about subscribing before the first mount.
      detachAll();
      getWidget()?.destroy();
    },
    on: (event, handler) => {
      const registration: Registration = {
        event,
        handler: handler as ChatEventHandler<ChatEventName>,
        release: null,
      };
      registrations.add(registration);

      // Binds immediately when a widget is already up — including one mounted
      // through the module export rather than through this API, which is why
      // this reads `getWidget()` rather than trusting `attachedTo`.
      const widget = getWidget();
      if (widget !== null) {
        attachedTo = widget;
        attach(registration, widget);
      }

      return () => {
        registrations.delete(registration);
        detach(registration);
      };
    },
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

  mountAndAttach(configFromAttributes(script.dataset));
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
