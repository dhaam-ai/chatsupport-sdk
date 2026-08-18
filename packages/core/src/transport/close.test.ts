import { describe, expect, it } from 'vitest';

import { buildCloseInfo } from './close.js';
import { CLOSE_CODE } from './socket.js';

const base = { reason: '', wasClean: true, protocolError: null } as const;

describe('buildCloseInfo', () => {
  it('surfaces the close code and reason intact', () => {
    const info = buildCloseInfo({
      ...base,
      code: CLOSE_CODE.GOING_AWAY,
      reason: 'server shutting down',
      cause: 'peer',
    });

    expect(info.code).toBe(1001);
    expect(info.reason).toBe('server shutting down');
  });

  // The backpressure signal. Retrying instantly just refills the buffer the
  // server closed us for filling.
  it('flags 1013 as backpressure', () => {
    const info = buildCloseInfo({
      ...base,
      code: CLOSE_CODE.TRY_AGAIN_LATER,
      reason: 'slow consumer',
      wasClean: true,
      cause: 'peer',
    });

    expect(info.backpressure).toBe(true);
    expect(info.code).toBe(1013);
    // Backpressure is emphatically still retryable — just not immediately.
    expect(info.retryable).toBe(true);
  });

  it('flags no other close code as backpressure', () => {
    for (const code of [1000, 1001, 1006, 1008, 1009, 1011, 1012, 1014, 4000]) {
      expect(buildCloseInfo({ ...base, code, cause: 'peer' }).backpressure).toBe(false);
    }
  });

  it('marks an unsupported protocol version non-retryable', () => {
    const protocolError = {
      code: 'PROTOCOL_VERSION_UNSUPPORTED',
      message: 'Client protocol version is no longer supported',
      retryable: false,
    } as const;

    const info = buildCloseInfo({
      code: CLOSE_CODE.POLICY_VIOLATION,
      reason: 'protocol version unsupported',
      wasClean: true,
      cause: 'versionUnsupported',
      protocolError,
    });

    expect(info.retryable).toBe(false);
    expect(info.protocolError).toBe(protocolError);
  });

  it('marks every other cause retryable', () => {
    for (const cause of ['peer', 'local', 'heartbeatTimeout'] as const) {
      expect(buildCloseInfo({ ...base, code: 1006, cause }).retryable).toBe(true);
    }
  });

  // 1008 covers five distinct server conditions with one reason string, so the
  // preceding error frame is the only way to tell them apart.
  it('carries the preceding error payload so 1008 can be disambiguated', () => {
    const info = buildCloseInfo({
      code: CLOSE_CODE.POLICY_VIOLATION,
      reason: 'authentication failed',
      wasClean: true,
      cause: 'peer',
      protocolError: { code: 'AUTH_EXPIRED', message: 'token expired', retryable: true },
    });

    expect(info.protocolError?.code).toBe('AUTH_EXPIRED');
    // Retryability of an auth failure is T8's escalation policy, not the
    // transport's — the transport only refuses to retry a version mismatch.
    expect(info.retryable).toBe(true);
  });

  it('reports an abnormal close honestly', () => {
    const info = buildCloseInfo({
      code: CLOSE_CODE.ABNORMAL,
      reason: '',
      wasClean: false,
      cause: 'peer',
      protocolError: null,
    });

    expect(info).toEqual({
      code: 1006,
      reason: '',
      wasClean: false,
      cause: 'peer',
      retryable: true,
      backpressure: false,
      protocolError: null,
    });
  });
});
