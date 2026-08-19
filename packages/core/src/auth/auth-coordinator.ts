// Auth coordination — task T9, folded together with Gap A (guest sessions)
// per PLAN-v2-core-adoption.md's "T9a folded into T9" decision: there is no
// reason to build the auth module twice, once without guest support and
// once with it.
//
// Owns:
//  - Supplying `ConnectionMachine`'s injected `buildHello` — token-mode when
//    `getToken` is configured, guest-mode (persisted `guestId`) when it
//    isn't (§10.4, Gap A).
//  - Proactive refresh: schedules the next `getToken()` call at 80% of the
//    current token's remaining lifetime (§10.4), read from its JWT `exp`
//    claim — `getToken()`'s signature is just `() => Promise<string>`, so
//    core has no other source for when a token expires.
//  - Reactive refresh: an `AUTH_EXPIRED` error frame while connected
//    triggers an immediate refresh, as a fallback for clock skew or an
//    unexpectedly short-lived token (§10.4).
//  - Sending `connection.reauth` on the already-open socket for both paths
//    (D3, §10.5) rather than tearing the connection down.
//  - `identify()` — Gap A's guest→authenticated upgrade: supplies
//    `getToken` (previously absent) and reauthenticates in place if
//    currently connected.
//  - Falling back to a full reconnect (§10.5's defensive fallback) if
//    in-place reauth fails for any reason — deliberately NOT reimplementing
//    `ConnectionMachine`'s (T8) own auth-failure/backoff/suspend pipeline
//    here; a failed reauth just drops the connection and lets that
//    already-built, already-tested pipeline run again from a clean slate,
//    via the same `buildHello` this class already supplies.

import type { ServerFrame } from '../protocol/index.js';
import { CORE_PROTOCOL_VERSION } from '../protocol/index.js';
import type { StorageAdapter } from '../storage/index.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import { generateUlid } from '../ulid.js';
import type { ConnectionMachine, HelloCredentials } from '../connection/index.js';
import type { Unsubscribe } from '../transport/index.js';
import { getOrCreateGuestId } from './guest-identity.js';
import { decodeJwtExpiryMs, decodeJwtSubject } from './jwt.js';
import { TokenRefreshScheduler } from './token-refresh-scheduler.js';

export type GetToken = () => Promise<string>;

export interface AuthCoordinatorOptions {
  publishableKey: string;
  /** Absent → guest mode (Gap A). Present → authenticated, token-based mode. */
  getToken?: GetToken;
  /** Where the guest id persists across reloads. Defaults to in-memory (not persisted). */
  storage?: StorageAdapter;
  /** Fraction of a token's remaining lifetime at which to proactively refresh. Default 0.8 (§10.4). */
  proactiveRefreshFraction?: number;
}

const DEFAULT_PROACTIVE_REFRESH_FRACTION = 0.8;
const REAUTH_RESPONSE_TIMEOUT_MS = 10_000;

export class AuthCoordinator {
  readonly #publishableKey: string;
  readonly #storage: StorageAdapter;
  readonly #proactiveRefreshFraction: number;
  readonly #refreshScheduler: TokenRefreshScheduler;
  readonly #unsubscribers: Unsubscribe[] = [];

  #getToken: GetToken | undefined;
  #connection: ConnectionMachine | undefined;
  #lastToken: string | undefined;
  #lastGuestId: string | undefined;
  #reauthInFlight = false;

  constructor(options: AuthCoordinatorOptions) {
    this.#publishableKey = options.publishableKey;
    this.#getToken = options.getToken;
    this.#storage = options.storage ?? new MemoryStorageAdapter();
    this.#proactiveRefreshFraction = options.proactiveRefreshFraction ?? DEFAULT_PROACTIVE_REFRESH_FRACTION;
    this.#refreshScheduler = new TokenRefreshScheduler({ onRefresh: () => void this.#performReauth() });
  }

  /** True until `identify()` (or a constructor-supplied `getToken`) establishes a real identity. */
  get isGuest(): boolean {
    return this.#getToken === undefined;
  }

  /**
   * The current credential for REST calls (T11's `RestClient` — structurally
   * compatible with its `RestAuth`, no shared import needed). Reflects
   * whichever `buildHello()`/reauth call most recently succeeded; empty
   * (`{}`) before the first one has.
   */
  get currentAuth(): { token?: string; guestId?: string } {
    if (this.#lastToken !== undefined) return { token: this.#lastToken };
    if (this.#lastGuestId !== undefined) return { guestId: this.#lastGuestId };
    return {};
  }

  /**
   * This client's own sender id — the JWT `sub` claim when identified, the
   * guest id otherwise. Falls back to the guest id (generating one if
   * needed isn't possible synchronously here, so this returns `undefined`
   * only in the narrow window before the very first `buildHello()` call
   * has resolved at all).
   */
  get senderId(): string | undefined {
    if (this.#lastToken !== undefined) return decodeJwtSubject(this.#lastToken) ?? this.#lastGuestId;
    return this.#lastGuestId;
  }

  /**
   * The credential-building callback `ConnectionMachine` (T8) calls on
   * every (re)connect attempt. Bound as a field, not a prototype method, so
   * it can be passed directly as `buildHello` without the caller needing to
   * `.bind(this)`.
   */
  buildHello = async (): Promise<HelloCredentials> => {
    const getToken = this.#getToken;
    if (getToken) {
      const token = await getToken();
      if (!token) throw new Error('AuthCoordinator: getToken() resolved to an empty value.');
      this.#lastToken = token;
      return { token, publishableKey: this.#publishableKey };
    }
    this.#lastToken = undefined;
    const guestId = await getOrCreateGuestId(this.#storage);
    this.#lastGuestId = guestId;
    return { guestId, publishableKey: this.#publishableKey };
  };

  /**
   * Wires this coordinator to an already-constructed `ConnectionMachine`.
   * Separate from the constructor because `buildHello` must exist *before*
   * `ConnectionMachine` can be built (it's a constructor option there), but
   * this method needs the built instance to listen to. Call once, right
   * after constructing both:
   *
   * ```ts
   * const auth = new AuthCoordinator({ publishableKey, getToken });
   * const connection = new ConnectionMachine({ url, transport, buildHello: auth.buildHello });
   * auth.attach(connection);
   * ```
   */
  attach(connection: ConnectionMachine): Unsubscribe {
    this.#connection = connection;
    const unsubscribers = [
      connection.on('connected', () => this.#scheduleProactiveRefresh()),
      connection.on('frame', (frame) => this.#handleFrame(frame)),
      connection.on('stateChange', ({ state }) => {
        if (state !== 'connected') this.#refreshScheduler.cancel();
      }),
    ];
    this.#unsubscribers.push(...unsubscribers);
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }

  /**
   * Gap A's guest→identified upgrade. Supplies `getToken` (replacing any
   * previously configured one) and, if currently connected, immediately
   * reauthenticates on the open socket. If not currently connected, the
   * next connect attempt picks up the new `getToken` naturally via
   * `buildHello` — no extra bookkeeping needed for that case.
   */
  async identify(getToken: GetToken): Promise<void> {
    this.#getToken = getToken;
    if (this.#connection?.state === 'connected') {
      await this.#performReauth();
    }
  }

  destroy(): void {
    this.#refreshScheduler.cancel();
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
  }

  #scheduleProactiveRefresh(): void {
    if (this.#lastToken === undefined) return; // guest connection — nothing to refresh
    const expiryMs = decodeJwtExpiryMs(this.#lastToken);
    if (expiryMs === undefined) return; // can't schedule proactively; reactive AUTH_EXPIRED handling still covers this token
    const remainingMs = expiryMs - Date.now();
    this.#refreshScheduler.scheduleIn(remainingMs * this.#proactiveRefreshFraction);
  }

  #handleFrame(frame: ServerFrame): void {
    if (frame.t !== 'error') return;
    if (frame.d.code !== 'AUTH_EXPIRED') return;
    void this.#performReauth();
  }

  async #performReauth(): Promise<void> {
    const getToken = this.#getToken;
    const connection = this.#connection;
    if (!getToken || !connection || connection.state !== 'connected' || this.#reauthInFlight) return;

    this.#reauthInFlight = true;
    try {
      const token = await getToken();
      if (!token) throw new Error('AuthCoordinator: getToken() resolved to an empty value during reauth.');
      this.#lastToken = token;

      const frameId = generateUlid();
      const responseOk = this.#waitForReauthResponse(connection, frameId);
      connection.send({ v: CORE_PROTOCOL_VERSION, t: 'connection.reauth', id: frameId, ts: Date.now(), d: { token } });

      if (await responseOk) {
        this.#scheduleProactiveRefresh();
      } else {
        this.#fallbackToReconnect();
      }
    } catch {
      this.#fallbackToReconnect();
    } finally {
      this.#reauthInFlight = false;
    }
  }

  /** Resolves once the reauth frame is acked/errored, the connection stops being `connected`, or a timeout elapses — whichever comes first. Never hangs forever. */
  #waitForReauthResponse(connection: ConnectionMachine, frameId: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        unsubscribeFrame();
        unsubscribeState();
        clearTimeout(timer);
        resolve(ok);
      };

      const unsubscribeFrame = connection.on('frame', (frame) => {
        if (frame.t === 'ack' && frame.ref === frameId) {
          settle(frame.d.ok);
        } else if (frame.t === 'error' && frame.ref === frameId) {
          settle(false);
        }
      });
      const unsubscribeState = connection.on('stateChange', ({ state }) => {
        if (state !== 'connected') settle(false);
      });
      const timer = setTimeout(() => settle(false), REAUTH_RESPONSE_TIMEOUT_MS);
    });
  }

  #fallbackToReconnect(): void {
    const connection = this.#connection;
    // Only act if the connection is still sitting `connected` with a
    // broken identity. If it's already moved on (a transport drop raced
    // with this reauth attempt), ConnectionMachine's own recovery is
    // already handling it — calling disconnect()/connect() here too would
    // fight that instead of helping.
    if (!connection || connection.state !== 'connected') return;
    connection.disconnect();
    connection.connect();
  }
}
