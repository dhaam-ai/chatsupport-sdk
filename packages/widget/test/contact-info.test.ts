// @vitest-environment node
//
// `contact-info.ts` is the one place in this package that gathers the
// ip-watermark, the raw UA, and a GPS fix for the console's contact-info
// panel — see its header for why NONE of this may block `connect()`. These
// tests pin exactly that: every failure mode (network error, bad status,
// malformed body, no Geolocation API, a denied/timed-out prompt) resolves to
// `null`/does nothing, never throws, and `captureContactInfo` calls
// `setContactInfo` independently for each piece that actually resolved.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captureContactInfo,
  captureGeolocation,
  fetchIpWatermark,
} from '../src/contact-info.js';
import type { ContactInfoSink } from '../src/contact-info.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchIpWatermark', () => {
  it('parses a well-formed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ip: '203.0.113.7', watermark: 'abc.def' }) }),
    );

    const result = await fetchIpWatermark('https://api.example.com');
    expect(result).toEqual({ ip: '203.0.113.7', watermark: 'abc.def' });
  });

  it('hits the fixed path under the given apiUrl, with no trailing slash duplicated', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ip: '1.2.3.4', watermark: 'w' }) });
    vi.stubGlobal('fetch', fetchMock);

    await fetchIpWatermark('https://api.example.com/');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/chat-services/api/v1/ip-watermark',
      expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store' }),
    );
  });

  it('returns null on a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await fetchIpWatermark('https://api.example.com')).toBeNull();
  });

  it('returns null on a malformed body (missing fields, wrong types)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ip: 7 }) }));
    expect(await fetchIpWatermark('https://api.example.com')).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }));
    expect(await fetchIpWatermark('https://api.example.com')).toBeNull();
  });

  it('returns null, never throws, on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchIpWatermark('https://api.example.com')).resolves.toBeNull();
  });

  it('returns null, never throws, when the request is aborted (timeout)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, options: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }),
    );

    await expect(fetchIpWatermark('https://api.example.com', 5)).resolves.toBeNull();
  });
});

describe('captureGeolocation', () => {
  it('resolves null when there is no Geolocation API at all', async () => {
    vi.stubGlobal('navigator', {});
    expect(await captureGeolocation()).toBeNull();
  });

  it('resolves lat/lng on a granted, successful fix', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) => {
          success({ coords: { latitude: 37.7749, longitude: -122.4194 } } as GeolocationPosition);
        },
      },
    });

    expect(await captureGeolocation()).toEqual({ lat: 37.7749, lng: -122.4194 });
  });

  it('resolves null — never rejects — when permission is denied', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
          error({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError);
        },
      },
    });

    await expect(captureGeolocation()).resolves.toBeNull();
  });

  it('passes its timeout through to the browser API rather than racing a second timer', () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    void captureGeolocation(1234);

    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ timeout: 1234, enableHighAccuracy: false }),
    );
  });
});

describe('captureContactInfo', () => {
  function sink(): { sink: ContactInfoSink; calls: Array<Record<string, unknown>> } {
    const calls: Array<Record<string, unknown>> = [];
    return { sink: { setContactInfo: (info) => calls.push(info as Record<string, unknown>) }, calls };
  }

  it('records userAgent synchronously, and ip/ipWatermark/geo once each resolves', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 TestAgent',
      geolocation: {
        getCurrentPosition: (success: PositionCallback) => {
          success({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition);
        },
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ip: '203.0.113.7', watermark: 'wm' }) }),
    );

    const { sink: contactSink, calls } = sink();

    // Synchronous userAgent call happens before the function's own await —
    // this is the property the widget relies on to send it on the FIRST hello
    // even when the two async captures below have not settled yet.
    const done = captureContactInfo(contactSink, 'https://api.example.com');
    expect(calls).toEqual([{ userAgent: 'Mozilla/5.0 TestAgent' }]);

    await done;

    expect(calls).toContainEqual({ ip: '203.0.113.7', ipWatermark: 'wm' });
    expect(calls).toContainEqual({ geo: { lat: 1, lng: 2 } });
    expect(calls).toHaveLength(3);
  });

  it('records nothing beyond userAgent when both async captures fail', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 TestAgent' }); // no geolocation
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { sink: contactSink, calls } = sink();
    await captureContactInfo(contactSink, 'https://api.example.com');

    expect(calls).toEqual([{ userAgent: 'Mozilla/5.0 TestAgent' }]);
  });
});
