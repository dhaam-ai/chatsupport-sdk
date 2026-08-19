import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../storage/index.js';
import type { StorageAdapter } from '../storage/index.js';
import { getOrCreateGuestId } from './guest-identity.js';

function alwaysFailingStorage(): StorageAdapter {
  return {
    get: () => Promise.reject(new Error('storage unavailable')),
    set: () => Promise.reject(new Error('storage unavailable')),
    remove: () => Promise.reject(new Error('storage unavailable')),
  };
}

describe('getOrCreateGuestId', () => {
  it('generates a guest-prefixed id on first use', async () => {
    const id = await getOrCreateGuestId(new MemoryStorageAdapter());

    expect(id).toMatch(/^guest_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('persists the id so a second call returns the same one', async () => {
    const storage = new MemoryStorageAdapter();

    const first = await getOrCreateGuestId(storage);
    const second = await getOrCreateGuestId(storage);

    expect(second).toBe(first);
  });

  it('gives different storage instances independent ids', async () => {
    const a = await getOrCreateGuestId(new MemoryStorageAdapter());
    const b = await getOrCreateGuestId(new MemoryStorageAdapter());

    expect(a).not.toBe(b);
  });

  it('falls back to a fresh, unpersisted id when storage.get() fails', async () => {
    const id = await getOrCreateGuestId(alwaysFailingStorage());

    expect(id).toMatch(/^guest_/);
  });

  it('still returns a usable id when storage.set() fails after a successful get() miss', async () => {
    const storage: StorageAdapter = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('quota exceeded')),
      remove: () => Promise.resolve(),
    };

    const id = await getOrCreateGuestId(storage);

    expect(id).toMatch(/^guest_/);
  });

  it('does not persist across two calls when storage is unavailable (each call generates its own)', async () => {
    const storage = alwaysFailingStorage();

    const first = await getOrCreateGuestId(storage);
    const second = await getOrCreateGuestId(storage);

    expect(first).not.toBe(second);
  });
});
