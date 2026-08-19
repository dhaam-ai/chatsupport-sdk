// Where every subscription this package opens gets closed.
//
// `onScopeDispose`, NOT `onUnmounted`. The two are not interchangeable and the
// difference is the single most common way a Vue binding leaks:
//
//   onUnmounted     needs a current component instance. Called from a
//                   composable that is itself called from a Pinia store, a
//                   `watchEffect` body, a bare `effectScope()`, or a lazily
//                   `await`ed section of an async `setup()`, it registers
//                   nothing and warns — the subscription then lives as long as
//                   the ChatClient does.
//   onScopeDispose  needs a current *effect scope*, which a component instance
//                   always has (Vue sets `instance.scope` active for the whole
//                   of `setup()`, and stops it on unmount) AND which
//                   `effectScope()` gives you with no component in sight.
//
// So `onScopeDispose` is a strict superset: it covers everything `onUnmounted`
// covers, plus every non-component caller. This package's conformance adapter
// mounts consumers as real components; its leak tests also mount them in a bare
// `effectScope()`, and both must unsubscribe.

import { getCurrentScope, onScopeDispose } from 'vue';

/**
 * Registers `cleanup` on the current effect scope.
 *
 * With no active scope there is nowhere to hang teardown, and the caller has
 * already opened a subscription — so this warns rather than failing silently.
 * A silent no-op here is exactly the leak this module exists to prevent, and
 * it is invisible until a long-lived page has accumulated hundreds of live
 * listeners on one client.
 *
 * @param cleanup  the unsubscribe to run when the scope stops
 * @param what     names the composable in the warning, so the fix is obvious
 */
export function onChatScopeDispose(cleanup: () => void, what: string): void {
  if (getCurrentScope() !== undefined) {
    onScopeDispose(cleanup);
    return;
  }

  // Deliberately console.warn and not throw: the subscription above is already
  // live and working, so the composable's *value* is correct — what is wrong is
  // that nothing will ever tear it down. Throwing would turn a leak into an
  // outage; staying silent would hide it forever.
  console.warn(
    `[@dhaam-ccrm/vue] ${what}() was called with no active effect scope, so its ChatClient ` +
      'subscription can never be released and will live as long as the client does. Call it ' +
      "from a component's setup(), or wrap the call in effectScope() and stop() that scope " +
      'when you are done.',
  );
}
