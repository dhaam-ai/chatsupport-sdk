import { useChannel, type ConnectionState } from '@dhaam-ccrm/react';

/**
 * Connection state, plus connect/disconnect.
 *
 * Accessibility: the state is announced, not just coloured. `role="status"`
 * gives an implicit `aria-live="polite"`, so a screen reader hears
 * "reconnecting" without the user having to go looking for it — and the text
 * itself carries the state, so the colour is redundant rather than load-bearing.
 * https://www.w3.org/TR/wai-aria-1.2/#status
 */

/** Human-readable, and the text a screen reader announces. */
const STATE_LABELS: Record<ConnectionState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  authenticating: 'Authenticating…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  suspended: 'Suspended — giving up after repeated failures',
  closed: 'Disconnected',
};

const BUSY_STATES: ReadonlySet<ConnectionState> = new Set<ConnectionState>([
  'connecting',
  'authenticating',
  'reconnecting',
]);

export function ConnectionPanel(): JSX.Element {
  const { connectionState, session, lastError, connect, disconnect } = useChannel();

  const busy = BUSY_STATES.has(connectionState);
  const online = connectionState === 'connected';

  return (
    <section className="panel" aria-labelledby="connection-heading">
      <h2 id="connection-heading">Connection</h2>

      <p className="status-line">
        <span className={`dot dot--${connectionState}`} aria-hidden="true" />
        <span role="status" className="status-text">
          {STATE_LABELS[connectionState]}
        </span>
      </p>

      <div className="button-row">
        <button type="button" onClick={() => void connect()} disabled={online || busy}>
          Connect
        </button>
        <button type="button" onClick={disconnect} disabled={!online && !busy}>
          Disconnect
        </button>
      </div>

      <dl className="facts">
        <dt>Session</dt>
        <dd>{session ? session.id : <em>none yet</em>}</dd>
        <dt>Status</dt>
        <dd>{session ? session.status : <em>—</em>}</dd>
      </dl>

      {/* role="alert" — an error is assertive; the user has to know now. */}
      {lastError ? (
        <p role="alert" className="error">
          <strong>{lastError.code}</strong> {lastError.message}
        </p>
      ) : null}
    </section>
  );
}
