import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from './memory.js';

describe('MemoryStorageAdapter', () => {
  it('round-trips a value through set/get/remove', async () => {
    const storage = new MemoryStorageAdapter();

    await storage.set('session', 'abc123');
    expect(await storage.get('session')).toBe('abc123');

    await storage.remove('session');
    expect(await storage.get('session')).toBeNull();
  });

  it('returns null — not undefined — for a missing key', async () => {
    const storage = new MemoryStorageAdapter();

    const value = await storage.get('never-written');

    // Asserted strictly: `undefined` leaking out would give callers two
    // distinct "absent" values to handle, which the contract forbids.
    expect(value).toBeNull();
    expect(value).not.toBeUndefined();
  });

  it('overwrites an existing value', async () => {
    const storage = new MemoryStorageAdapter();

    await storage.set('draft', 'first');
    await storage.set('draft', 'second');

    expect(await storage.get('draft')).toBe('second');
  });

  it('treats removing an absent key as success', async () => {
    const storage = new MemoryStorageAdapter();

    await expect(storage.remove('was-never-there')).resolves.toBeUndefined();
  });

  it('preserves values that are easy to confuse with absence', async () => {
    const storage = new MemoryStorageAdapter();

    // An empty string is a stored value, not a missing key. A `??`/falsy check
    // in the implementation would collapse these two cases.
    await storage.set('empty', '');
    expect(await storage.get('empty')).toBe('');

    await storage.set('null-literal', 'null');
    expect(await storage.get('null-literal')).toBe('null');
  });

  it('isolates instances from one another', async () => {
    const a = new MemoryStorageAdapter();
    const b = new MemoryStorageAdapter();

    await a.set('shared-key', 'from-a');

    expect(await b.get('shared-key')).toBeNull();
  });
});
