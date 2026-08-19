// Shared in-memory WebSocketLike test double — extracted from T7's own
// tests so T8 (and later T9) can reuse the exact same deterministic double
// instead of each task re-declaring it. Lives under `test/`, not
// `src/transport/`, for the same "test-only, never shipped" reason T6's
// fake server does.

import { WS_READY_STATE } from '../src/transport/index.js';
import type { WebSocketLike } from '../src/transport/index.js';

export class MockWebSocket implements WebSocketLike {
  readyState: number = WS_READY_STATE.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this.onclose?.({ code, reason });
  }

  // ── Test-only simulation helpers, not part of WebSocketLike ──────────────

  simulateOpen(): void {
    this.readyState = WS_READY_STATE.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  simulateError(): void {
    this.onerror?.({});
  }
}
