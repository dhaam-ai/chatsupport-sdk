// The platform WebSocket seam.
//
// Two rules drive every shape in this file:
//
// 1. **The global is never read at module scope.** `createPlatformWebSocketFactory`
//    returns a closure that probes `globalThis.WebSocket` when it is *called*.
//    A module-level `const WS = globalThis.WebSocket` would throw on import
//    under SSR / Node < 22 and would make the whole transport untestable
//    without a DOM shim. PRD §14 pins core to "any environment with a native
//    `WebSocket` global" — that is a runtime requirement, not an import-time one.
//
// 2. **`WebSocketLike` names only what the transport actually uses.** It does
//    not reference DOM `Event`/`MessageEvent`/`CloseEvent` types, so core's
//    emitted `.d.ts` stays DOM-free and a React Native or test double can
//    satisfy it with a plain object.
//
// Those two rules cost exactly one cast, in `createPlatformWebSocketFactory`.
// The platform `WebSocket` types its handlers as properties (`onopen`,
// `onmessage`, …) whose parameters are DOM event types; under
// `strictFunctionTypes` those properties are checked contravariantly, so a
// real `WebSocket` is *not* structurally assignable to any handler shape whose
// parameters we could usefully read. This is the same trade presence/time.ts
// documents for timer handles: confine the untypable platform detail to the
// single function that touches the platform, and keep every consumer clean.

/** The `message` event, narrowed to the one field the codec reads. */
export interface SocketMessageEvent {
  /** `string` for text frames. Anything else is rejected by the codec (D4). */
  readonly data: unknown;
}

/** The `close` event, narrowed to the three fields T8 needs to pick a retry policy. */
export interface SocketCloseEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

/**
 * The subset of the WebSocket API this transport depends on.
 *
 * Deliberately omits `readyState`, `bufferedAmount`, `binaryType`,
 * `addEventListener` and the `CONNECTING`/`OPEN`/… constants: the transport
 * tracks its own lifecycle from the handler callbacks, so requiring a stub to
 * emulate `readyState` would add surface without adding safety.
 */
export interface WebSocketLike {
  /** Sends one text frame. May throw if the socket is already closing. */
  send(data: string): void;

  /** Begins the closing handshake. `onclose` follows. */
  close(code?: number, reason?: string): void;

  onopen: (() => void) | null;
  onmessage: ((event: SocketMessageEvent) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: SocketCloseEvent) => void) | null;
}

/**
 * Opens a socket to `url`. Injected into the transport so tests supply a
 * stub and so non-browser hosts can supply their own implementation.
 */
export type WebSocketFactory = (url: string) => WebSocketLike;

/**
 * WebSocket close codes this transport reasons about.
 *
 * Values 1000-1015 are the RFC 6455 / IANA registry codes; the conditions
 * below are the ones the real `chat-service-node` v2 endpoint actually
 * produces (`src/api/websocket/v2/`), verified against that source.
 *
 * Note there are **no 4xxx application close codes** on this endpoint. 1008
 * covers five distinct server conditions (hello timeout, unsupported protocol
 * version, and three flavours of auth failure), all with the same reason
 * string. The only discriminator is the `error` frame the server sends
 * immediately *before* closing — which is why `TransportCloseInfo` carries
 * `protocolError` rather than expecting T8 to read meaning into the code.
 */
export const CLOSE_CODE = {
  /** Normal closure. What this client sends when T8 calls `close()`. */
  NORMAL: 1000,

  /** Server shutting down (`registry.closeAll(1001, …)`). Transient — reconnect. */
  GOING_AWAY: 1001,

  /**
   * No close frame was received. Never sent on the wire — it is what a
   * client observes when the connection vanished: a network drop, or the
   * server's liveness reaper calling `terminate()` on a silent peer.
   * Expected and retryable, not exceptional.
   */
  ABNORMAL: 1006,

  /**
   * Policy violation. Ambiguous by itself — see the note above.
   */
  POLICY_VIOLATION: 1008,

  /** Frame exceeded the server's 256 KiB `maxPayload`. */
  MESSAGE_TOO_BIG: 1009,

  /**
   * Try Again Later. The server closes with this when a connection's
   * outbound buffer passes its 1 MiB ceiling — a slow consumer. Reconnecting
   * instantly just refills the buffer, so T8 must back off, not retry hot.
   * Surfaced as `TransportCloseInfo.backpressure`.
   */
  TRY_AGAIN_LATER: 1013,
} as const;

type WebSocketConstructor = new (url: string) => unknown;

/**
 * The default `WebSocketFactory`, backed by the ambient `WebSocket` global.
 *
 * Calling this function does not touch any global — only the returned
 * closure does, and only when it opens a socket. So constructing a transport
 * is safe during SSR, at import time, and in a test that has deleted the
 * global entirely.
 *
 * @throws Error when no `WebSocket` global exists at connect time.
 */
export function createPlatformWebSocketFactory(): WebSocketFactory {
  return (url: string): WebSocketLike => {
    const Ctor = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;

    if (typeof Ctor !== 'function') {
      throw new Error(
        'No global WebSocket is available in this environment. ' +
          'Pass a `webSocket` factory to the transport to supply one.',
      );
    }

    // The one cast this seam costs — see the file header for why the
    // platform type cannot be checked structurally against `WebSocketLike`.
    return new Ctor(url) as WebSocketLike;
  };
}
