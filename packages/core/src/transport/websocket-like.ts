// The structural WebSocket shape `Transport` depends on — PRD §7.1 ("raw
// WebSocket, no socket.io") plus §4's "no DOM-only global at module scope"
// invariant.
//
// Deliberately NOT `typeof WebSocket` (lib.dom's ambient type). Depending on
// that type would tie this module to the DOM lib being present in whatever
// consumes it, which is exactly the portability core is not allowed to
// assume. Any implementation that satisfies this shape works: a browser's
// native WebSocket, Node's global WebSocket (stable since Node 22), a future
// React Native JSI polyfill, or `ws` running in its browser-compatible mode
// (assigning `.onopen`/`.onmessage`/... rather than using EventEmitter's
// `.on`) — the property-assignment style, not `addEventListener`, is the one
// all of those genuinely agree on.

export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/**
 * Uses the ambient global `WebSocket` constructor. Throws immediately
 * (rather than failing confusingly later, inside a `connect()` call) if none
 * exists in the current environment — a caller on a platform with no global
 * WebSocket must supply an explicit `webSocketFactory` instead.
 */
export const defaultWebSocketFactory: WebSocketFactory = (url) => {
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      'Transport: no global WebSocket constructor is available in this environment. Pass an explicit webSocketFactory.',
    );
  }
  return new WebSocket(url) as unknown as WebSocketLike;
};
