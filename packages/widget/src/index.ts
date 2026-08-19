// @dhaam-ccrm/widget — the drop-in embeddable chat widget.
//
// Two ways in, one implementation behind both:
//
//   <script src="…/widget.js" data-publishable-key="dhp_live_…"> — src/embed.ts
//   import { mount } from '@dhaam-ccrm/widget'                   — this file
//
// ── What this package is allowed to receive ─────────────────────────────
//
// A publishable key and a URL to the HOST's own token endpoint. Never a
// secret key: there is no config field for one (config.ts), the publishable
// slot is validated through core's `parsePublishableKey`, and every other
// host-supplied string is swept with the same predicate (auth.ts). That is
// §14, and it is the reason this package can be served from a CDN at all.

import { resolveConfig } from './config.js';
import { clearWidget, describeExisting, getMountedWidget, registerWidget } from './singleton.js';
import { createWidget } from './widget.js';
import type { ChatWidget } from './widget.js';
import type { WidgetConfig } from './config.js';

/**
 * Mounts the widget, or returns the one already on the page.
 *
 * Idempotent by design rather than by accident — see singleton.ts for the
 * double-script-tag case this exists to survive. To replace a mounted widget
 * with a differently-configured one, `destroy()` it first.
 */
export function mount(config: WidgetConfig): ChatWidget {
  const existing = getMountedWidget();
  if (existing !== null) {
    // Not an exception: the second script tag is usually not the one anybody
    // is debugging, and throwing from it would take out whatever else that
    // bundle was doing. Loud enough to find, quiet enough not to break a page.
    config.onError?.(new Error(`chat widget mount() ignored${describeExisting()}`));
    return existing;
  }

  const widget = createWidget(config);
  const wrapped: ChatWidget = {
    ...widget,
    store: widget.store,
    destroy() {
      widget.destroy();
      clearWidget(wrapped);
    },
  };
  registerWidget(wrapped);
  return wrapped;
}

/** The mounted widget, or `null`. */
export function getWidget(): ChatWidget | null {
  return getMountedWidget();
}

/** Tears down whatever is mounted. Safe to call when nothing is. */
export function unmount(): void {
  getMountedWidget()?.destroy();
}

/**
 * Builds a widget WITHOUT the one-per-page guard.
 *
 * For the genuine multi-instance case — a food-ordering marketplace embedding
 * one conversation per live order on a single page. Callers own teardown.
 */
export { createWidget };

export { resolveConfig, WidgetConfigError, parseMode } from './config.js';
export { looksLikeSecretKey } from './auth.js';
export { resolvePresentation } from './ui/presentation.js';

export type { ChatWidget } from './widget.js';
export type { WidgetConfig, WidgetAuth, WidgetIdentity, ResolvedConfig } from './config.js';
export type { PresentationMode, ResolvedPresentation } from './ui/presentation.js';

// Re-exported so a host typing a `getToken` or reading `store.getState()` has
// one import specifier rather than three.
export type { ChatState, ChatMessage, ChatStore, MessageTickState } from '@dhaam-ccrm/js';
