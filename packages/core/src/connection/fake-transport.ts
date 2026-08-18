// A hand-driven `ConnectionTransport`, so the state machine's *policy* can be
// tested without a socket, a codec, or an ack round trip in the picture.
//
// Lives in src/ for the same reason `transport/stub-socket.ts` and
// `presence/manual-timers.ts` do: several test files need it, it ships zero
// runtime dependencies, and T13's src/index.ts decides separately whether it
// leaves the package.
//
// It mirrors two behaviours of the real `WebSocketTransport` exactly, because
// a fake that is kinder than reality would let genuine bugs through:
//
//   - `connect()` on an already-open transport **synchronously** reports a
//     close with `cause: 'local'` for the socket it supersedes, from inside
//     the call. This is the re-entrancy the controller is built around.
//   - `close()` does the same. Both are `local`, and the controller must
//     discard both.
//
// What it does NOT do is simulate a network: `open()`, `emitFrame()` and
// `drop()` are driven explicitly by the test. Socket-level behaviour — the
// hello write, close codes, orphaned handles — is covered against the real
// transport over `StubSocketFactory` instead.

import type { ClientFramePayloadMap, ServerFrame } from '../protocol/index.js';
import type {
  AckOutcome,
  AckableClientFrameType,
  PendingSend,
  TransportCloseInfo,
  TransportConnectOptions,
} from '../transport/index.js';
import { CLOSE_CODE, buildCloseInfo } from '../transport/index.js';
import type { ConnectionTransport, TransportHandlers } from './types.js';

/** One recorded `send()`, with the handle to settle its ack by hand. */
export interface FakeSend {
  readonly id: string;
  readonly t: AckableClientFrameType;
  readonly d: unknown;
  readonly ack: Promise<AckOutcome>;
  readonly settle: (outcome: AckOutcome) => void;
}

export class FakeTransport implements ConnectionTransport {
  /** Every `connect()` call, in order — `hello` included, so `resumeFrom` is assertable. */
  readonly connects: TransportConnectOptions[] = [];

  /** Every `send()` call, in order. */
  readonly sends: FakeSend[] = [];

  /** How many times `close()` was called. */
  closeCalls = 0;

  isOpen = false;

  /** True once a socket has been opened and not yet reported closed. */
  #live = false;
  #nextId = 0;

  readonly #handlers: TransportHandlers;

  constructor(handlers: TransportHandlers) {
    this.#handlers = handlers;
  }

  connect(options: TransportConnectOptions): void {
    this.#supersede('superseded by a new connection');
    this.connects.push(options);
    this.#live = true;
  }

  send<T extends AckableClientFrameType>(t: T, d: ClientFramePayloadMap[T]): PendingSend {
    const id = `fake-${this.#nextId++}`;

    let settle!: (outcome: AckOutcome) => void;
    const ack = new Promise<AckOutcome>((resolve) => {
      settle = resolve;
    });

    if (!this.isOpen) {
      // Matches the real transport: a send with no open socket resolves
      // immediately as `disconnected` rather than hanging.
      settle({ status: 'disconnected', close: null });
    }

    this.sends.push({ id, t, d, ack, settle });
    return { id, ack };
  }

  close(): void {
    this.closeCalls += 1;
    this.#supersede('client disconnect');
  }

  // ---------------------------------------------------------------------
  // Test drivers
  // ---------------------------------------------------------------------

  /** Socket open AND `connection.hello` written — fires `onOpen`. */
  open(): void {
    this.isOpen = true;
    this.#live = true;
    this.#handlers.onOpen();
  }

  /** Delivers one inbound frame. */
  emitFrame(frame: ServerFrame): void {
    this.#handlers.onFrame(frame);
  }

  /** Reports a peer-side close. Defaults to a retryable 1006. */
  drop(info: Partial<TransportCloseInfo> = {}): void {
    this.isOpen = false;
    this.#live = false;
    this.#handlers.onClose(
      buildCloseInfo({
        code: info.code ?? CLOSE_CODE.ABNORMAL,
        reason: info.reason ?? 'connection lost',
        wasClean: info.wasClean ?? false,
        cause: info.cause ?? 'peer',
        protocolError: info.protocolError ?? null,
      }),
    );
  }

  /** The most recent `connect()`'s options. */
  get lastConnect(): TransportConnectOptions {
    const last = this.connects[this.connects.length - 1];
    if (last === undefined) throw new Error('FakeTransport: connect() has not been called');
    return last;
  }

  /** The most recent `send()`. */
  get lastSend(): FakeSend {
    const last = this.sends[this.sends.length - 1];
    if (last === undefined) throw new Error('FakeTransport: send() has not been called');
    return last;
  }

  /**
   * The synchronous `cause: 'local'` close that both `connect()` and `close()`
   * produce for the socket they replace — the re-entrancy the controller must
   * discard.
   */
  #supersede(reason: string): void {
    if (!this.#live) return;
    this.isOpen = false;
    this.#live = false;
    this.#handlers.onClose(
      buildCloseInfo({
        code: CLOSE_CODE.NORMAL,
        reason,
        wasClean: true,
        cause: 'local',
        protocolError: null,
      }),
    );
  }
}
