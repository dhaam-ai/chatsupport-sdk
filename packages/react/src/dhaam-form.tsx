// <DhaamForm /> — the web form at a route in the merchant's own React app.
//
//   <Route path="/contact" element={<DhaamForm publishableKey="dhp_live_…"
//                                              apiUrl="https://chat.example.com" />} />
//
// ── What this adds, and what it deliberately does not ────────────────────
//
// Nothing about the form is decided here. @dhaam-ccrm/widget's `mountForm`
// builds it, styles it, reads the boot, applies the caps and submits it, and
// this file supplies the one thing that package cannot have an opinion about:
// an element that appears and disappears on the merchant's own navigation.
// That lifecycle is the whole contribution, which is why this component lives
// in the React binding and not in the widget.
//
// It is also why this is the one export in this package that needs no
// `ChatProvider`, no `ChatClient` and no token. The form's only credential is
// the publishable key, which authenticates nothing on its own; a contact page
// that had to stand up a socket first would be a chat widget with extra steps.
//
// ── Why there is no `AbortController` here ───────────────────────────────
//
// A route component unmounting mid-flight is the ordinary case, so the boot
// read must be abortable — and it already is, one layer down. `mountForm`
// owns the `AbortController` it passes to `readFormBoot`, and `destroy()`
// aborts it. `MountFormOptions` has no `signal` field to hand one to, and
// adding a second controller here would abort nothing the first does not:
// `destroy()` in the cleanup below IS the abort. Proved at this boundary
// rather than assumed — test/dhaam-form.test.ts asserts on the `signal` the
// boot `fetch` was actually given, after React has unmounted the route.
//
// ── SSR ──────────────────────────────────────────────────────────────────
//
// No `window` or `document` is touched at module scope or during render. The
// import above is a module that only READS the DOM inside functions, and the
// only call into it is in an effect, which never runs on a server. A Next.js
// app can render this component on the server and hydrate it — see
// test/dhaam-form-ssr.test.ts, which renders it with no DOM present at all.

import { mountForm } from '@dhaam-ccrm/widget';
import type { MountFormOptions } from '@dhaam-ccrm/widget';
import { useEffect, useRef } from 'react';

export interface DhaamFormProps {
  /**
   * `dhp_…`. The only credential this form has or needs.
   *
   * Changing it remounts the form: a different key is a different tenant, and
   * the boot read, the caps it applies and the submit route's answer all
   * belong to that tenant rather than to this component.
   */
  readonly publishableKey: string;

  /**
   * Origin of chat-service. No trailing slash required.
   *
   * Named and typed exactly as `mountForm`'s own option rather than renamed to
   * something friendlier: a merchant reading one of the two docs must not have
   * to discover that `baseUrl` and `apiUrl` are the same string. Required for
   * the same reason it is required there — there is no sensible default origin
   * for someone else's deployment, and guessing one produces a form that fails
   * only at submit time.
   */
  readonly apiUrl: string;

  /** Applied to the host element, for the merchant's own layout and width. */
  readonly className?: string;

  /**
   * Fired once, after an accepted submission. Same receipt `mountForm` gives.
   *
   * Read through a ref, so passing a fresh arrow function on every render —
   * which is what every React codebase does — does not remount the form and
   * throw away what the visitor has typed.
   */
  readonly onSubmitted?: MountFormOptions['onSubmitted'];

  /**
   * Diagnostics for the DEVELOPER. Never shown to the visitor. Also read
   * through a ref.
   */
  readonly onError?: MountFormOptions['onError'];
}

/**
 * Mounts the standalone web form into one host element of its own.
 *
 * ── Mount, unmount, remount ──────────────────────────────────────────────
 *
 *   The effect re-runs on `publishableKey` / `apiUrl` only. A re-render for
 *   any other reason — a parent's state, a new `className`, a new callback —
 *   leaves the mounted form exactly where it is.
 *
 *   Unmounting calls `destroy()`, which removes the form and aborts the boot
 *   read. React removes the host element itself; `destroy()` is what stops the
 *   in-flight request and frees the element for a later mount.
 *
 *   React 18 `<StrictMode>` runs every effect mount → cleanup → mount in dev.
 *   That is exactly the sequence above, so the second pass mounts into an
 *   element the first pass has already given back: one form, one live boot,
 *   and nothing reported to `onError`.
 *
 * A `FormConfigError` from `mountForm` — an empty `apiUrl`, or a SECRET key
 * pasted where the publishable one belongs — propagates out of this effect
 * rather than being reported and swallowed. That is `mountForm`'s decision and
 * it is kept: a secret key in a page any visitor can read must stop the mount
 * loudly, and the alternative is a blank rectangle that hides a leaked
 * credential.
 */
export function DhaamForm(props: DhaamFormProps): JSX.Element {
  const { apiUrl, publishableKey } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);

  const onSubmittedRef = useRef(props.onSubmitted);
  onSubmittedRef.current = props.onSubmitted;
  const onErrorRef = useRef(props.onError);
  onErrorRef.current = props.onError;

  useEffect(() => {
    const host = hostRef.current;
    // React has attached the ref before any effect runs, so this is belt and
    // braces — but `mountForm` throws on a null target, and a thrown error
    // from a cleanup-less effect would take the merchant's route with it.
    if (host === null) return undefined;

    const handle = mountForm(host, {
      apiUrl,
      publishableKey,
      onSubmitted: (receipt) => onSubmittedRef.current?.(receipt),
      // Passed ONLY when the merchant actually has a handler, which is not
      // symmetry with `onSubmitted` above but the opposite of it, on purpose.
      // `mountForm` treats the presence of `onError` as "the host is handling
      // diagnostics" and stops writing them to the console — so a wrapper
      // passed unconditionally would silently swallow every warning a
      // merchant WITHOUT an `onError` would otherwise have seen. `onSubmitted`
      // has no such fallback to suppress.
      ...(onErrorRef.current === undefined
        ? {}
        : { onError: (error: unknown) => onErrorRef.current?.(error) }),
    });

    return () => {
      handle.destroy();
    };
  }, [apiUrl, publishableKey]);

  return <div ref={hostRef} {...(props.className === undefined ? {} : { className: props.className })} />;
}
