import { describe, expect, it } from 'vitest';

import type { Clock } from '../presence/index.js';
import { FaultStorageAdapter } from '../queue/fault-storage.js';
import { MemoryStorageAdapter } from '../storage/index.js';
import {
  IDENTITY_DEDUP_TTL_MS,
  profileFingerprint,
  recordIdentitySynced,
  shouldSyncIdentity,
} from './dedup.js';
import type { IdentityProfile } from './types.js';

describe('profileFingerprint', () => {
  it('is independent of top-level key order', () => {
    // The literal reason this function exists rather than `JSON.stringify`:
    // a host building the profile from a spread, a form, or `Object.assign`
    // has no control over key order, and must not re-identify because of it.
    const a: IdentityProfile = { name: 'Ada', email: 'ada@example.test' };
    const b: IdentityProfile = { email: 'ada@example.test', name: 'Ada' };

    expect(profileFingerprint('u1', a)).toBe(profileFingerprint('u1', b));
  });

  it('is independent of key order inside the nested device object', () => {
    const a: IdentityProfile = {
      device: { deviceId: 'd1', deviceToken: 't1', platform: 'web' },
    };
    const b: IdentityProfile = {
      device: { platform: 'web', deviceToken: 't1', deviceId: 'd1' },
    };

    expect(profileFingerprint('u1', a)).toBe(profileFingerprint('u1', b));
  });

  it('treats tags as a set — order and repeats do not change the profile', () => {
    // Deliberate: backend tag linking is lookup-only and additive, so neither
    // order nor a repeat can change the resulting server state. Skipping a
    // call that differs only this way skips a provable no-op. See the
    // `canonicalTags` comment — this test is the guard on that decision.
    const ordered: IdentityProfile = { tags: ['vip', 'beta'] };
    const reordered: IdentityProfile = { tags: ['beta', 'vip'] };
    const repeated: IdentityProfile = { tags: ['vip', 'beta', 'vip'] };

    expect(profileFingerprint('u1', reordered)).toBe(profileFingerprint('u1', ordered));
    expect(profileFingerprint('u1', repeated)).toBe(profileFingerprint('u1', ordered));
  });

  it('changes when a tag is actually added or removed', () => {
    const base = profileFingerprint('u1', { tags: ['vip'] });

    expect(profileFingerprint('u1', { tags: ['vip', 'beta'] })).not.toBe(base);
    expect(profileFingerprint('u1', { tags: [] })).not.toBe(base);
  });

  it('changes when any single field changes', () => {
    const base: IdentityProfile = {
      name: 'Ada',
      email: 'ada@example.test',
      phone: '+15550000000',
      city: 'Pune',
      country: 'IN',
      tags: ['vip'],
      device: { deviceId: 'd1', deviceToken: 't1', platform: 'web' },
    };
    const baseline = profileFingerprint('u1', base);

    const mutations: readonly IdentityProfile[] = [
      { ...base, name: 'Grace' },
      { ...base, email: 'grace@example.test' },
      { ...base, phone: '+15550000001' },
      { ...base, city: 'Mumbai' },
      { ...base, country: 'US' },
      { ...base, tags: ['vip', 'beta'] },
      { ...base, device: { deviceId: 'd2', deviceToken: 't1', platform: 'web' } },
      { ...base, device: { deviceId: 'd1', deviceToken: 't2', platform: 'web' } },
      { ...base, device: { deviceId: 'd1', deviceToken: 't1', platform: 'ios' } },
    ];

    for (const mutated of mutations) {
      expect(profileFingerprint('u1', mutated)).not.toBe(baseline);
    }
  });

  it('changes when a field is dropped entirely', () => {
    const withCity = profileFingerprint('u1', { name: 'Ada', city: 'Pune' });
    const withoutCity = profileFingerprint('u1', { name: 'Ada' });

    expect(withCity).not.toBe(withoutCity);
  });

  it('treats an explicitly-undefined field as absent', () => {
    // `{ email: undefined }` and `{}` serialise to the same request body, so
    // they must be the same profile here. Otherwise a host that spreads an
    // optional field re-identifies on every load. Cast because
    // `exactOptionalPropertyTypes` forbids writing this in TypeScript — only
    // an untyped JS caller can produce it, and one will.
    const explicit = { name: 'Ada', email: undefined } as unknown as IdentityProfile;

    expect(profileFingerprint('u1', explicit)).toBe(profileFingerprint('u1', { name: 'Ada' }));
  });

  it('changes when the userId changes for an identical profile', () => {
    const profile: IdentityProfile = { name: 'Ada' };

    expect(profileFingerprint('u1', profile)).not.toBe(profileFingerprint('u2', profile));
  });

  it('is stable across calls and shaped as 16 hex characters', () => {
    const profile: IdentityProfile = { name: 'Ada', tags: ['vip'] };
    const first = profileFingerprint('u1', profile);

    expect(profileFingerprint('u1', profile)).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not collide across values that a naive concatenation would merge', () => {
    // `name: 'ab', city: ''` vs `name: 'a', city: 'b'` — the classic failure
    // of hashing joined field values without their delimiters or keys.
    const a = profileFingerprint('u1', { name: 'ab', city: '' });
    const b = profileFingerprint('u1', { name: 'a', city: 'b' });

    expect(a).not.toBe(b);
  });
});

describe('shouldSyncIdentity / recordIdentitySynced', () => {
  const USER = 'user-1';
  const PROFILE: IdentityProfile = { name: 'Ada', email: 'ada@example.test', tags: ['vip'] };
  const T0 = 1_700_000_000_000;

  /**
   * An injected clock the test moves by hand. The whole reason the gate takes
   * a `Clock` rather than reading `Date.now()`: a fifteen-minute TTL is
   * otherwise only testable by waiting fifteen minutes.
   */
  function manualClock(start = T0): { now: Clock; advance(ms: number): void } {
    let current = start;
    return {
      now: () => current,
      advance: (ms) => {
        current += ms;
      },
    };
  }

  it('sends when storage holds nothing yet', async () => {
    const clock = manualClock();

    await expect(
      shouldSyncIdentity({
        storage: new MemoryStorageAdapter(),
        userId: USER,
        profile: PROFILE,
        now: clock.now,
      }),
    ).resolves.toBe(true);
  });

  it('skips a matching profile inside the TTL', async () => {
    const storage = new MemoryStorageAdapter();
    const clock = manualClock();
    const options = { storage, userId: USER, profile: PROFILE, now: clock.now };

    await recordIdentitySynced(options);
    clock.advance(IDENTITY_DEDUP_TTL_MS - 1);

    await expect(shouldSyncIdentity(options)).resolves.toBe(false);
  });

  it('sends again once the TTL has elapsed', async () => {
    const storage = new MemoryStorageAdapter();
    const clock = manualClock();
    const options = { storage, userId: USER, profile: PROFILE, now: clock.now };

    await recordIdentitySynced(options);
    // Exactly at the boundary, not past it: the window is half-open, so the
    // TTL-th millisecond sends rather than being the last one suppressed.
    clock.advance(IDENTITY_DEDUP_TTL_MS);

    await expect(shouldSyncIdentity(options)).resolves.toBe(true);
  });

  it('sends immediately when the profile changed inside the TTL', async () => {
    const storage = new MemoryStorageAdapter();
    const clock = manualClock();

    await recordIdentitySynced({ storage, userId: USER, profile: PROFILE, now: clock.now });
    clock.advance(1_000);

    await expect(
      shouldSyncIdentity({
        storage,
        userId: USER,
        profile: { ...PROFILE, city: 'Pune' },
        now: clock.now,
      }),
    ).resolves.toBe(true);
  });

  it('still skips when only the tag order changed inside the TTL', async () => {
    // The set-semantics decision has to survive the round trip through
    // storage, not just hold inside profileFingerprint.
    const storage = new MemoryStorageAdapter();
    const clock = manualClock();

    await recordIdentitySynced({
      storage,
      userId: USER,
      profile: { tags: ['vip', 'beta'] },
      now: clock.now,
    });
    clock.advance(1_000);

    await expect(
      shouldSyncIdentity({
        storage,
        userId: USER,
        profile: { tags: ['beta', 'vip'] },
        now: clock.now,
      }),
    ).resolves.toBe(false);
  });

  it('sends for a different user holding an identical profile', async () => {
    const storage = new MemoryStorageAdapter();
    const clock = manualClock();

    await recordIdentitySynced({ storage, userId: USER, profile: PROFILE, now: clock.now });

    await expect(
      shouldSyncIdentity({ storage, userId: 'user-2', profile: PROFILE, now: clock.now }),
    ).resolves.toBe(true);
  });

  it('sends when the stored record is stamped in the future', async () => {
    // A device clock that moved backwards, or a record we did not write.
    // Trusting it would suppress identify until real time caught up.
    const storage = new MemoryStorageAdapter();
    const clock = manualClock();

    await recordIdentitySynced({ storage, userId: USER, profile: PROFILE, now: () => T0 + 86_400_000 });

    await expect(
      shouldSyncIdentity({ storage, userId: USER, profile: PROFILE, now: clock.now }),
    ).resolves.toBe(true);
  });

  it.each([
    ['unparseable JSON', 'not json at all'],
    ['a JSON scalar', '"just-a-string"'],
    ['JSON null', 'null'],
    ['a record missing its fingerprint', JSON.stringify({ syncedAt: T0 })],
    ['a record missing its timestamp', JSON.stringify({ fingerprint: 'abc' })],
    ['a non-numeric timestamp', JSON.stringify({ fingerprint: 'abc', syncedAt: 'soon' })],
    ['a NaN timestamp', '{"fingerprint":"abc","syncedAt":null}'],
  ])('sends when storage holds %s', async (_label, stored) => {
    const storage = new MemoryStorageAdapter();
    await storage.set('identitySync', stored);

    await expect(
      shouldSyncIdentity({ storage, userId: USER, profile: PROFILE, now: manualClock().now }),
    ).resolves.toBe(true);
  });

  it('degrades to send — never to skip — when the read rejects', async () => {
    // The safety-critical direction. `StorageAdapter`'s contract says a
    // rejected `get` means UNKNOWN, not absent; unknown must cost a redundant
    // POST, never a silently dropped one.
    const storage = new FaultStorageAdapter();
    const clock = manualClock();
    const options = { storage, userId: USER, profile: PROFILE, now: clock.now };

    await recordIdentitySynced(options);
    // Prove the record really is there and would otherwise suppress the call.
    await expect(shouldSyncIdentity(options)).resolves.toBe(false);

    storage.failNextGet = 'read_failed';
    await expect(shouldSyncIdentity(options)).resolves.toBe(true);
  });

  it('does not reject when the write fails, and re-sends next time', async () => {
    const storage = new FaultStorageAdapter();
    storage.failEverySet = 'quota_exceeded';
    const clock = manualClock();
    const options = { storage, userId: USER, profile: PROFILE, now: clock.now };

    await expect(recordIdentitySynced(options)).resolves.toBeUndefined();
    expect(storage.setCalls).toEqual(['identitySync']);

    // Nothing landed, so the gate has no record and sends again — the same
    // harmless direction a rejecting read degrades to.
    await expect(shouldSyncIdentity(options)).resolves.toBe(true);
  });

  it('writes exactly one key, under the documented name', async () => {
    const storage = new FaultStorageAdapter();
    const clock = manualClock();

    await recordIdentitySynced({ storage, userId: USER, profile: PROFILE, now: clock.now });
    await recordIdentitySynced({ storage, userId: 'user-2', profile: PROFILE, now: clock.now });

    // One key for all users, by design: a second user overwrites the first,
    // whose fingerprint then no longer matches, so they re-identify.
    expect(storage.setCalls).toEqual(['identitySync', 'identitySync']);
  });
});
