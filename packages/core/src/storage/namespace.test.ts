import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from './memory.js';
import { namespaced } from './namespace.js';
import { StorageError } from './errors.js';
import type { StorageAdapter } from './types.js';

describe('namespaced', () => {
  describe('isolation across a shared backing store', () => {
    it('keeps two namespaces from colliding on the same key', async () => {
      const shared = new MemoryStorageAdapter();
      const acme = namespaced(shared, 'tenant-acme');
      const globex = namespaced(shared, 'tenant-globex');

      await acme.set('queue', 'acme-messages');
      await globex.set('queue', 'globex-messages');

      expect(await acme.get('queue')).toBe('acme-messages');
      expect(await globex.get('queue')).toBe('globex-messages');
    });

    it('reports a key written in another namespace as absent', async () => {
      const shared = new MemoryStorageAdapter();
      const acme = namespaced(shared, 'tenant-acme');
      const globex = namespaced(shared, 'tenant-globex');

      await acme.set('queue', 'acme-messages');

      expect(await globex.get('queue')).toBeNull();
    });

    it('does not let one namespace remove another namespace key', async () => {
      const shared = new MemoryStorageAdapter();
      const acme = namespaced(shared, 'tenant-acme');
      const globex = namespaced(shared, 'tenant-globex');

      await acme.set('queue', 'acme-messages');
      await globex.remove('queue');

      expect(await acme.get('queue')).toBe('acme-messages');
    });

    it('round-trips set/get/remove within one namespace', async () => {
      const scoped = namespaced(new MemoryStorageAdapter(), 'client-1');

      await scoped.set('draft', 'hello');
      expect(await scoped.get('draft')).toBe('hello');

      await scoped.remove('draft');
      expect(await scoped.get('draft')).toBeNull();
    });
  });

  describe('key construction', () => {
    it('writes through to the underlying adapter under a prefixed key', async () => {
      const shared = new MemoryStorageAdapter();

      await namespaced(shared, 'tenant-acme').set('queue', 'messages');

      // Asserted on the real backing key so the partitioning scheme is pinned,
      // not just its observable effect.
      expect(await shared.get('tenant-acme:queue')).toBe('messages');
      expect(await shared.get('queue')).toBeNull();
    });

    it('nests, so a client namespace can sit inside a tenant namespace', async () => {
      const shared = new MemoryStorageAdapter();
      const scoped = namespaced(namespaced(shared, 'tenant'), 'client');

      await scoped.set('queue', 'messages');

      expect(await shared.get('tenant:client:queue')).toBe('messages');
    });

    it('allows the delimiter inside a key, which cannot collide', async () => {
      const shared = new MemoryStorageAdapter();
      const scoped = namespaced(shared, 'tenant');

      await scoped.set('queue:pending', 'messages');

      expect(await scoped.get('queue:pending')).toBe('messages');
    });
  });

  describe('namespace validation', () => {
    it('rejects a namespace containing the delimiter', () => {
      // Guards a real collision: namespace "a:b" + key "c" and namespace "a" +
      // key "b:c" would both resolve to "a:b:c", silently merging two tenants.
      expect(() => namespaced(new MemoryStorageAdapter(), 'a:b')).toThrow(
        TypeError,
      );
    });

    it('rejects an empty namespace', () => {
      expect(() => namespaced(new MemoryStorageAdapter(), '')).toThrow(
        TypeError,
      );
    });

    it('rejects eagerly, not on first use', () => {
      // Constructing must fail loudly rather than returning an adapter that
      // quietly shares a keyspace with another tenant.
      expect(() => namespaced(new MemoryStorageAdapter(), 'a:b')).toThrow();
    });
  });

  describe('failure contract pass-through', () => {
    it('propagates a rejected write unchanged', async () => {
      const failure = new StorageError('quota_exceeded', 'full');
      const failing: StorageAdapter = {
        get: () => Promise.resolve(null),
        set: () => Promise.reject(failure),
        remove: () => Promise.resolve(),
      };

      const scoped = namespaced(failing, 'tenant');

      // The wrapper must not soften the contract into a resolve, or namespacing
      // would reintroduce exactly the silently-swallowed write it must not.
      await expect(scoped.set('queue', 'messages')).rejects.toBe(failure);
    });

    it('propagates a rejected read unchanged', async () => {
      const failure = new StorageError('read_failed', 'blocked');
      const failing: StorageAdapter = {
        get: () => Promise.reject(failure),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      };

      await expect(namespaced(failing, 'tenant').get('queue')).rejects.toBe(
        failure,
      );
    });
  });
});
