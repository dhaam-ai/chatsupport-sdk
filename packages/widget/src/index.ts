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

import { defaultOnError, resolveConfig } from './config.js';
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
    (config.onError ?? defaultOnError)(new Error(`chat widget mount() ignored${describeExisting()}`));
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

// The visitor-facing chooser's published surface (design §11): a host that
// wants to read the resolved support entry itself — a custom launcher, a
// status page — needs these without reaching into the package's internals,
// and `entryFor`/`shouldMount` are the one place the six-row reading lives.
export { entryFor, parseSupport, shouldMount } from './remote-config.js';
export type { SupportEntry, ResolvedEntry } from './remote-config.js';

// The anonymous web-form client, published for the same reason `createWidget`
// is: a third-party integrator building their own surface on this contract
// should have one client to agree with, not a second one that can drift —
// see docs/design/sdk-visitor-chooser.md §11's "OR-J" on exactly that risk.
export { submitWebform, visitorMessage, WebformError, WEBFORM_PATH, WEBFORM_TIMEOUT_MS } from './webform.js';
export type { WebformDraft, WebformReceipt, WebformFailureKind } from './webform.js';

// The web form WITHOUT the chat widget — no launcher, no panel, no socket, no
// session, no token mint. `mountForm` puts it in an element the caller names,
// which is the one thing the three surfaces above it (an inline embed, an
// iframe embed, a mountable route component) do not agree on.
//
// `readFormBoot` is published alongside it because those surfaces sometimes
// need the answer BEFORE they have an element to render into — a hosted page
// deciding whether to render a form at all, say — and a second implementation
// of that read is how the two would come to disagree about one tenant.
//
// `parentOriginFromLocation` is the frame side's one line: a hosted page
// reads `?origin=` with it and passes the result straight to `mountForm` as
// `parentOrigin`, which is what makes the iframe embed resize.
export { mountForm, getMountedForm, readFormBoot, parentOriginFromLocation, FormConfigError, FORM_BOOT_PATH, FORM_BOOT_TIMEOUT_MS } from './form.js';
export type {
  MountFormOptions,
  MountedForm,
  FormBoot,
  FormCopy,
  FormFieldLimits,
  ContactRequirement,
  DhaamFormGlobal,
} from './form.js';

// The iframe embed's HOST half — the merchant's own page, which creates the
// frame and applies the heights the page inside posts up. Its counterpart on
// the frame side is `mountForm`'s `parentOrigin` option, and the protocol
// both are written against is the header of `src/form-embed.ts`.
//
// `hostedOrigin` is required there and has no default: this package has no
// canonical console origin to bake in, and guessing one would point a
// merchant's contact page at someone else's deployment.
//
// `EMBED_UNREACHABLE_TIMEOUT_MS` is exported for the same reason
// `FORM_BOOT_TIMEOUT_MS` above is: it is the deadline behind an
// `onUnreachable` callback, and a caller rendering their own fallback needs
// to know how long they waited for it.
export {
  embedForm,
  FormEmbedError,
  EMBED_MIN_HEIGHT_PX,
  EMBED_UNREACHABLE_TIMEOUT_MS,
  FORM_RESIZE_MESSAGE_TYPE,
} from './form-embed.js';
export type { EmbedFormOptions, EmbedHandle, DhaamFormEmbedGlobal } from './form-embed.js';

export type { ChatWidget } from './widget.js';
export type { WidgetConfig, WidgetAuth, WidgetIdentity, ResolvedConfig } from './config.js';
export type { PresentationMode, ResolvedPresentation } from './ui/presentation.js';

// Re-exported because a host cannot fill in `WidgetIdentity.profile` without
// being able to name its type, and making them take a second dependency on
// @dhaam-ccrm/core to type one config field would defeat the point of a
// drop-in package. `IdentitySync` is deliberately NOT here: the widget builds
// that one itself, and a host has no slot to put its own in.
export type { IdentityProfile } from '@dhaam-ccrm/core';

// Re-exported so a host typing a `getToken` or reading `store.getState()` has
// one import specifier rather than three.
export type { ChatState, ChatMessage, ChatStore, MessageTickState } from '@dhaam-ccrm/js';
