import { describe, expect, it } from 'vitest';

import {
  BrowserStorageAdapter,
  createBrowserStorageAdapter,
  type WebStorageLike,
} from './browser.js';
import { StorageError } from './errors.js';

/**
 * A controllable `localStorage` stand-in.
 *
 * `faults` is mutable so a test can let the constructor's capability probe
 * succeed and *then* start failing — which is how production behaves: storage
 * works at page load and fills up later.
 */
function createFakeStorage(seed: Record<string, string> = {}) {
  const entries = new Map<string, string>(Object.entries(seed));
  const faults: { get?: unknown; set?: unknown; remove?: unknown } = {};

  const store: WebStorageLike = {
    get length() {
      return entries.size;
    },
    getItem(key) {
      if (faults.get !== undefined) throw faults.get;
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      if (faults.set !== undefined) throw faults.set;
      entries.set(key, value);
    },
    removeItem(key) {
      if (faults.remove !== undefined) throw faults.remove;
      entries.delete(key);
    },
  };

  return { store, faults, entries };
}

/** What a browser actually throws when the store is full. */
function quotaExceededError(): unknown {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

/** How the same condition presents via the legacy numeric code. */
function legacyQuotaError(): unknown {
  return Object.assign(new Error('QUOTA_EXCEEDED_ERR'), { code: 22 });
}

/** What a sandboxed iframe or blocked-cookies context throws on any access. */
function securityError(): unknown {
  return new DOMException('The operation is insecure.', 'SecurityError');
}

describe('BrowserStorageAdapter', () => {
  describe('normal operation', () => {
    it('round-trips a value through set/get/remove', async () => {
      const { store } = createFakeStorage();
      const storage = new BrowserStorageAdapter(store);

      await storage.set('queue', '["m1"]');
      expect(await storage.get('queue')).toBe('["m1"]');

      await storage.remove('queue');
      expect(await storage.get('queue')).toBeNull();
    });

    it('returns null — not undefined — for a missing key', async () => {
      const { store } = createFakeStorage();
      const storage = new BrowserStorageAdapter(store);

      const value = await storage.get('never-written');

      expect(value).toBeNull();
      expect(value).not.toBeUndefined();
    });

    it('leaves no probe key behind after construction', () => {
      const { store, entries } = createFakeStorage();

      new BrowserStorageAdapter(store);

      expect(entries.size).toBe(0);
    });
  });

  describe('quota exceeded', () => {
    it('rejects — never resolves — when a write exceeds quota', async () => {
      const { store, faults } = createFakeStorage();
      const storage = new BrowserStorageAdapter(store);
      faults.set = quotaExceededError();

      // The contract that matters. If this ever resolved, the send queue would
      // record the message as durably persisted and the user would lose it on
      // reload having been shown it as sent.
      const result = await storage
        .set('queue', '["m1"]')
        .then(() => 'resolved' as const)
        .catch(() => 'rejected' as const);

      expect(result).toBe('rejected');
    });

    it('tags the failure quota_exceeded so callers can prune and retry', async () => {
      const { store, faults } = createFakeStorage();
      const storage = new BrowserStorageAdapter(store);
      faults.set = quotaExceededError();

      const error = await storage.set('queue', 'x').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe('quota_exceeded');
    });

    it('recognises the legacy numeric quota code (22)', async () => {
      const { store, faults } = createFakeStorage();
      const storage = new BrowserStorageAdapter(store);
      faults.set = legacyQuotaError();

      const error = await storage.set('queue', 'x').catch((e: unknown) => e);

      expect((error as StorageError).code).toBe('quota_exceeded');
    });

    it('preserves the underlying platform error as the cause', async () => {
      const { store, faults } = createFakeStorage();
      const storage = new BrowserStorageAdapter(store);
      const platformError = quotaExceededError();
      faults.set = platformError;

      const error = await storage.set('queue', 'x').catch((e: unknown) => e);

      expect((error as StorageError).cause).toBe(platformError);
    });
  });

  describe('access throws (sandboxed iframe, blocked site data)', () => {
    it('rejects a read with read_failed rather than reporting absence', async () => {
      const { store, faults } = createFakeStorage();
      const storage = new BrowserStorageAdapter(store);
      faults.get = securityError();

      const error = await storage.get('queue').catch((e: unknown) => e);

      // Must not resolve to null: "unknown" and "absent" are different, and
      // conflating them would read a storage fault as an empty queue.
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe('read_failed');
    });

    it('rejects a non-quota write with write_failed', async () => {
      const { store, faults } = createFakeStorage();
      const storage = new BrowserStorageAdapter(store);
      faults.set = securityError();

      const error = await storage.set('queue', 'x').catch((e: unknown) => e);

      expect((error as StorageError).code).toBe('write_failed');
    });

    it('rejects a failed removal, since the key may still be present', async () => {
      const { store, faults } = createFakeStorage();
      const storage = new BrowserStorageAdapter(store);
      faults.remove = securityError();

      const error = await storage.remove('queue').catch((e: unknown) => e);

      expect((error as StorageError).code).toBe('write_failed');
    });
  });

  describe('availability probe', () => {
    it('rejects a store that throws on every write', () => {
      const { store, faults } = createFakeStorage();
      faults.set = securityError();

      expect(() => new BrowserStorageAdapter(store)).toThrow(StorageError);
    });

    it('reports unavailable rather than a per-operation code', () => {
      const { store, faults } = createFakeStorage();
      faults.set = securityError();

      const error = (() => {
        try {
          new BrowserStorageAdapter(store);
          return null;
        } catch (e: unknown) {
          return e as StorageError;
        }
      })();

      expect(error?.code).toBe('unavailable');
    });

    it('rejects a disabled store that presents as quota-exceeded while empty', () => {
      // Safari private mode historically reported a 0-byte quota this way.
      const { store, faults } = createFakeStorage();
      faults.set = quotaExceededError();

      expect(() => new BrowserStorageAdapter(store)).toThrow(StorageError);
    });

    it('accepts a store that is merely full, since it still works', () => {
      // Quota error but data already present: storage functions, callers can
      // prune per §9.6. Mirrors MDN's storageAvailable().
      const { store, faults } = createFakeStorage({ existing: 'data' });
      faults.set = quotaExceededError();

      expect(() => new BrowserStorageAdapter(store)).not.toThrow();
    });
  });

  describe('createBrowserStorageAdapter', () => {
    it('returns an adapter when storage works', () => {
      const { store } = createFakeStorage();

      expect(createBrowserStorageAdapter(store)).toBeInstanceOf(
        BrowserStorageAdapter,
      );
    });

    it('returns null instead of throwing when storage is unusable', () => {
      const { store, faults } = createFakeStorage();
      faults.set = securityError();

      // The documented degradation path: storage failure must never crash the
      // SDK, so the caller can fall back to memory with `?? new Memory...()`.
      expect(createBrowserStorageAdapter(store)).toBeNull();
    });
  });

  describe('in a Node context with no window', () => {
    it('confirms the environment really has no window or localStorage', () => {
      expect(typeof globalThis.window).toBe('undefined');
      expect(
        (globalThis as { localStorage?: unknown }).localStorage,
      ).toBeUndefined();
    });

    it('imports without throwing', () => {
      // Guards the SSR invariant: the module must reach no platform global at
      // module scope, or importing core on a server would crash. Reaching this
      // assertion at all proves the import evaluated cleanly.
      expect(BrowserStorageAdapter).toBeTypeOf('function');
      expect(createBrowserStorageAdapter).toBeTypeOf('function');
    });

    it('reports unavailable rather than a ReferenceError when constructed', () => {
      const error = (() => {
        try {
          new BrowserStorageAdapter();
          return null;
        } catch (e: unknown) {
          return e;
        }
      })();

      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe('unavailable');
    });

    it('degrades to null via the factory', () => {
      expect(createBrowserStorageAdapter()).toBeNull();
    });
  });
});
