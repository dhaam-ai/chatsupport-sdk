// One widget per page, enforced across separate copies of this bundle.
//
// ── Why a string key on `globalThis` and not a module variable ───────────
//
// The failure this exists to prevent is not "someone called `mount()` twice"
// — a module-scope variable would catch that. It is the script tag appearing
// twice: a tag-manager snippet plus a hardcoded one, a partial rendered inside
// a layout that already includes it, or an SPA re-injecting on route change.
// Each of those evaluates a SEPARATE copy of this bundle, with its own module
// scope, so the two copies can only find each other through something the
// document itself owns.
//
// A plain string rather than a `Symbol`, for exactly the same reason: two
// bundle copies produce two distinct symbols. `Symbol.for` would work, but the
// registry it uses is no less global than this property and is harder to
// inspect when a customer is on a support call trying to find out what is on
// their page.
//
// The version is part of the record so a mismatch is diagnosable: two
// different SDK versions on one page is a real thing that happens during a
// staged rollout, and "which one won" is the first question.

import type { ChatWidget } from './widget.js';

const GLOBAL_KEY = '__dhaamCcrmChatWidget__';

interface Registration {
  readonly version: string;
  readonly widget: ChatWidget;
}

interface GlobalWithRegistry {
  [GLOBAL_KEY]?: Registration;
}

const VERSION = '0.0.0';

function registry(): GlobalWithRegistry {
  return globalThis as unknown as GlobalWithRegistry;
}

export function getMountedWidget(): ChatWidget | null {
  return registry()[GLOBAL_KEY]?.widget ?? null;
}

export function registerWidget(widget: ChatWidget): void {
  registry()[GLOBAL_KEY] = { version: VERSION, widget };
}

export function clearWidget(widget: ChatWidget): void {
  // Compared before clearing: a `destroy()` on a widget that has already been
  // replaced must not unregister its successor.
  if (registry()[GLOBAL_KEY]?.widget === widget) delete registry()[GLOBAL_KEY];
}

export function describeExisting(): string {
  const existing = registry()[GLOBAL_KEY];
  return existing === undefined ? '' : ` (already mounted by version ${existing.version})`;
}
