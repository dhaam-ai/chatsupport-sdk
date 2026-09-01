// <OfflineBanner /> — the one rendered component this package ships.
//
// ── Why a headless package has a component at all ────────────────────────
//
// Everything else here is a hook, and that is the package's charter: "mapping
// core's observable store to React re-renders" and nothing else. A component
// library is a different product and this is not the start of one.
//
// This is the exception, for a reason specific to what it renders. The offline
// bar is not a design decision a host makes per app — it is the SDK's own
// promise about the durable send queue, in the SDK's own words, and every host
// that omits it ships the bug this feature exists to fix: a customer typing
// into a dead socket with nothing on screen to say their words are safe. Every
// host writing that div themselves means every host getting a chance to write
// it wrong, or to skip it under deadline. So the correct version is one import.
//
// It stays honest about being a binding in three ways:
//
//   It is the hook, rendered. There is no logic here that
//   {@link useOfflineBanner} does not already expose, so a host that wants a
//   different bar loses nothing by using the hook directly — which is the
//   documented path, not a fallback.
//
//   Styles are inline and overridable. No stylesheet to import, nothing
//   injected into the document, no class names to collide with a host's CSS —
//   and `style`/`className` are merged over the defaults rather than replacing
//   them, so "keep the layout, change the colours" is a two-line prop.
//
//   It renders nothing when there is nothing to say, which is most of the
//   time. A host can mount it unconditionally at the top of their chat panel
//   and forget it exists.

import type { CSSProperties, ReactNode } from 'react';

import { useOfflineBanner } from './use-offline-banner.js';
import type { OfflineBannerTone, UseOfflineBannerOptions } from './use-offline-banner.js';

export interface OfflineBannerProps extends UseOfflineBannerOptions {
  /** Merged over the built-in styles, so partial overrides keep the layout. */
  readonly style?: CSSProperties;

  /** Applied alongside the inline styles for a host that styles by class. */
  readonly className?: string;

  /**
   * Replaces the built-in wifi-off glyph. Pass `null` for no icon at all.
   * Whatever is passed is rendered `aria-hidden` — the sentence beside it
   * already carries the meaning.
   */
  readonly icon?: ReactNode;
}

/**
 * The two colour pairs.
 *
 * Amber for "your network", a warmer red for "we cannot be reached". Neither
 * is the failure red used for a failed send: nothing here has failed. Every
 * message is held and the connection is retrying, and a red bar for a tunnel
 * teaches customers that the red bar means nothing.
 *
 * Fixed values rather than anything derived from a host's theme, for the same
 * reason @dhaam-ccrm/widget's band is not tinted with the merchant's accent: a
 * status colour that follows the brand goes invisible on the brand it matches,
 * and this is the one surface whose whole job is to be noticed. A host with a
 * dark UI overrides `style`.
 */
const TONE_COLORS: Record<OfflineBannerTone, { background: string; color: string; border: string }> = {
  offline: { background: '#fef4e6', color: '#7a4a02', border: '#f3ddb8' },
  unreachable: { background: '#fdece9', color: '#8a2c1c', border: '#f6cfc7' },
};

const WIFI_OFF_PATHS = [
  'M2 2l20 20',
  'M8.5 16.4a5 5 0 0 1 7 0',
  'M5 12.9a10 10 0 0 1 3.6-2.3',
  'M16.9 11.2A10 10 0 0 1 19 12.9',
  'M2 8.8a15 15 0 0 1 5.5-3.3',
  'M12.2 4.5a15 15 0 0 1 9.8 4.3',
  'M12 20h.01',
];

function WifiOffIcon(): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {WIFI_OFF_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * Renders the offline bar, or nothing.
 *
 * ```tsx
 * <ChatProvider client={client}>
 *   <OfflineBanner />
 *   <Conversation />
 * </ChatProvider>
 * ```
 *
 * Mount it above the transcript and leave it there: it is hidden on a healthy
 * connection, and on a single blip, and it survives whatever navigation the
 * host does inside the panel, because losing your signal is a fact about the
 * whole conversation rather than about any one screen.
 *
 * Keep the composer ENABLED underneath it. That is not a suggestion about
 * layout — the sentence this renders promises that what the customer types now
 * will be sent later, and core's durable queue (§9.1, §8.4) makes that true. A
 * host that disables their input while this is showing has turned the promise
 * into a lie and thrown away the message it was protecting.
 *
 * Announced with `role="status"` (polite) rather than `alert`: an alert
 * interrupts a screen reader mid-message, and a dropped wifi does not earn
 * that.
 */
// No default parameter value on `props`, deliberately. A `props = {}` default
// makes TypeScript infer the component as `(props?: P) => …`, which
// `createElement` then cannot match against its `FunctionComponent<P>`
// overload — so `h(OfflineBanner, { style })` fails to typecheck for callers
// who are doing nothing wrong. React always passes an object, so the default
// was never load-bearing at runtime.
export function OfflineBanner(props: OfflineBannerProps): JSX.Element | null {
  const { style, className, icon, ...options } = props;
  const { banner } = useOfflineBanner(options);

  if (banner === null) return null;

  const tone = TONE_COLORS[banner.tone];

  return (
    <div
      role="status"
      aria-live="polite"
      data-tone={banner.tone}
      {...(className === undefined ? {} : { className })}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        fontSize: 12.5,
        lineHeight: 1.4,
        background: tone.background,
        color: tone.color,
        borderBottom: `1px solid ${tone.border}`,
        ...style,
      }}
    >
      {icon === undefined ? <WifiOffIcon /> : icon}
      <span style={{ overflowWrap: 'anywhere' }}>{banner.message}</span>
    </div>
  );
}
