// A hand-driven `WebSocketLike`, so tests exercise the transport without a
// network, a server, or a sleep.
//
// Lives in src/ rather than in a test file for the same reason
// presence/manual-timers.ts does: several test files plus anyone integrating
// against this transport need it, it ships zero runtime dependencies, and the
// package entry point (T13's src/index.ts) decides separately whether it
// leaves the package at all.
//
// Nothing here simulates the network. `open()`, `emitMessage()`,
// `emitClose()` are all driven explicitly by the test — in particular
// `close()` records the call but does NOT fire `onclose`, because half the
// bugs worth catching in this layer live in the gap between "we asked to
// close" and "the peer confirmed", and a stub that closes the gap
// automatically hides them.

import type { SocketCloseEvent, WebSocketLike } from './socket.js';
import { CLOSE_CODE } from './socket.js';
import type { WebSocketFactory } from './socket.js';

/** One recorded `close()` call. */
export interface StubCloseCall {
  readonly code: number | undefined;
  readonly reason: string | undefined;
}

export class StubWebSocket implements WebSocketLike {
  /** Raw text passed to `send()`, in order. */
  readonly sent: string[] = [];

  /** Every `close()` call, in order. */
  readonly closeCalls: StubCloseCall[] = [];

  /** When set, `send()` throws this instead of recording — simulates a dying socket. */
  sendError: Error | null = null;

  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: SocketCloseEvent) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    if (this.sendError) throw this.sendError;
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  // ---------------------------------------------------------------------
  // Test drivers
  // ---------------------------------------------------------------------

  /** Fires `onopen`. */
  open(): void {
    this.onopen?.();
  }

  /** Fires `onmessage` with `data` exactly as given — no serialization. */
  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** Fires `onmessage` with `value` serialized as a JSON text frame. */
  emitJson(value: unknown): void {
    this.emitMessage(JSON.stringify(value));
  }

  /** Fires `onerror`. Real sockets always follow this with a close. */
  emitError(): void {
    this.onerror?.();
  }

  /** Fires `onclose`. Defaults to a clean 1000. */
  emitClose(init: Partial<SocketCloseEvent> = {}): void {
    this.onclose?.({
      code: init.code ?? CLOSE_CODE.NORMAL,
      reason: init.reason ?? '',
      wasClean: init.wasClean ?? true,
    });
  }

  /** Every sent frame, JSON-parsed. Throws if anything sent was not JSON. */
  sentFrames(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw) as unknown);
  }

  /** The most recently sent frame, JSON-parsed. */
  lastSentFrame(): unknown {
    const raw = this.sent[this.sent.length - 1];
    if (raw === undefined) throw new Error('StubWebSocket: nothing has been sent');
    return JSON.parse(raw) as unknown;
  }
}

/**
 * A `WebSocketFactory` that mints `StubWebSocket`s and keeps every one it
 * made — so a test can assert on reconnect behaviour, not just the first
 * socket.
 */
export class StubSocketFactory {
  readonly sockets: StubWebSocket[] = [];

  /** Bound, so it can be passed as a bare `WebSocketFactory`. */
  readonly create: WebSocketFactory = (url: string): StubWebSocket => {
    const socket = new StubWebSocket(url);
    this.sockets.push(socket);
    return socket;
  };

  /** The most recently created socket. */
  get last(): StubWebSocket {
    const socket = this.sockets[this.sockets.length - 1];
    if (socket === undefined) throw new Error('StubSocketFactory: no socket has been created');
    return socket;
  }
}
