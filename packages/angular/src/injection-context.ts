// `inject()` throws NG0203 when called outside an injection context — even
// with `{ optional: true }`, which only governs a MISSING provider, not a
// missing context. `@angular/core` exports `assertInInjectionContext` (which
// throws) but no boolean `isInInjectionContext` predicate, so the only way to
// ask "am I in a context?" without crashing is to try and catch.
//
// This matters because `ChatStore.on()` must work BOTH inside a component/
// service injection context (where it should adopt the caller's `DestroyRef`
// and unsubscribe automatically) and outside one (a plain function, a test,
// or the binding-conformance suite, which mounts consumers with no injection
// context at all). Angular's own `takeUntilDestroyed()` takes the stricter
// route — it asserts and throws outside a context — which is not an option
// here.

import { inject } from '@angular/core';
import type { ProviderToken } from '@angular/core';

/**
 * `inject(token, { optional: true })` if there is an ambient injection
 * context, otherwise `null`. Never throws.
 */
export function injectIfAvailable<T>(token: ProviderToken<T>): T | null {
  try {
    return inject(token, { optional: true });
  } catch {
    // NG0203 (no injection context). A genuinely missing provider is already
    // handled by `{ optional: true }` returning null, so the only thing this
    // catch can swallow is the absence of a context — which is exactly the
    // case the caller wants reported as `null`.
    return null;
  }
}
