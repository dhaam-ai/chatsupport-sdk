// Identify dedup — the gate that makes "call identify on every load" cheap.
//
// Spec §7.3. An SPA that remounts the widget on every route change would
// otherwise POST /identify on every navigation. This module reduces that to at
// most one real call per user per TTL, by caching a fingerprint of the profile
// alongside the time it was last synced.
//
// ── Internal to core, deliberately ───────────────────────────────────────
//
// Nothing here is re-exported from `src/index.ts`. It is reachable from
// `./identity/index.js` so the client wiring can use it, and no further. The
// dedup policy is an implementation detail of when core calls the injected
// `IdentitySync`; a consumer who could reach in and record a false "already
// synced" could silently suppress a real identify.
//
// ── No globals, no wall clock ────────────────────────────────────────────
//
// This module reads no platform global at any time, not merely at module scope
// (PRD §15 / test/invariants/no-dom-at-module-scope.test.ts): the fingerprint
// hash is pure arithmetic over UTF-16 code units, and the current time arrives
// as an injected `Clock`. A TTL gate that read `Date.now()` itself could only
// be tested by sleeping for fifteen minutes.

import type { Clock } from '../presence/index.js';
import type { StorageAdapter } from '../storage/index.js';
import type { IdentityProfile } from './types.js';

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * FNV-1a, 64-bit. Parameters from the reference definition at
 * http://www.isthe.com/chongo/tech/comp/fnv/ ("FNV-1a hash parameters",
 * 64-bit row: offset basis 14695981039346656037, prime 1099511628211).
 *
 * BigInt rather than a pair of 32-bit lanes: `tsconfig.base.json` declares
 * `target`/`lib` ES2020, and BigInt is an ES2020 feature, so this sits exactly
 * on the floor the package already commits to. (Contrast `String.replaceAll`
 * in storage/namespace.ts, which is ES2021 — above the floor, and therefore
 * hand-rolled there.)
 *
 * Why hash at all, rather than store the canonical string and compare it?
 * Two reasons, both about what ends up sitting in `localStorage`: the profile
 * carries PII (email, phone) that nothing downstream needs in plaintext, and
 * an unbounded string competes for quota with the offline send queue sharing
 * the same adapter.
 *
 * 64 bits is far more than the collision odds warrant here. A collision
 * requires one user's *changed* profile to hash to their *previous* profile,
 * and even then costs only a delay — the TTL lapses and the next construction
 * sends anyway. It is not a permanent drop.
 */
const FNV_OFFSET_BASIS_64 = 0xcbf2_9ce4_8422_2325n;
const FNV_PRIME_64 = 0x0000_0100_0000_01b3n;
const U64_MASK = 0xffff_ffff_ffff_ffffn;

/**
 * Hashes `input` to 16 lowercase hex characters.
 *
 * Consumes UTF-16 code units as two bytes each rather than UTF-8, so that no
 * `TextEncoder` global is needed — that global is absent on some React Native
 * engines, and this file must run everywhere core runs. The byte stream is
 * still injective over JS strings, which is all a comparison hash requires;
 * the digest is never compared against one produced outside this module.
 */
function fnv1a64Hex(input: string): string {
  let hash = FNV_OFFSET_BASIS_64;

  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index);
    hash = ((hash ^ BigInt(unit & 0xff)) * FNV_PRIME_64) & U64_MASK;
    hash = ((hash ^ BigInt(unit >>> 8)) * FNV_PRIME_64) & U64_MASK;
  }

  return hash.toString(16).padStart(16, '0');
}

/**
 * Serialises `value` with object keys in sorted order, so that two objects
 * differing only in key order produce the same string.
 *
 * A generic walk rather than reading `IdentityProfile`'s fields by name: the
 * named-field version drifts silently the moment the contract grows a field
 * (as it just did, gaining `name`), and a field missing from the fingerprint
 * is a field whose change never re-syncs.
 *
 * `undefined`-valued keys are dropped, matching what `JSON.stringify` does to
 * them on the wire. `{ email: undefined }` and `{}` reach the backend as the
 * same request, so they must reach this hash as the same profile — otherwise a
 * host that spreads an absent field re-identifies on every single load.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((element: unknown) => canonicalJson(element)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);

  return `{${parts.join(',')}}`;
}

/**
 * Tags are compared as a SET: sorted and de-duplicated before hashing, so
 * `['vip','beta']`, `['beta','vip']` and `['vip','vip','beta']` are one
 * profile, not three.
 *
 * This is a deliberate coupling to how the backend consumes them, not a
 * convenience. Per the identify service, tag linking is lookup-only and
 * *additive*: each supplied tag is matched case-sensitively-or-not against
 * existing tags and linked if absent, nothing is ever unlinked, and re-linking
 * an already-linked tag is a no-op. Order therefore cannot change the
 * resulting server state, and neither can a repeat. Skipping a call that
 * differs only in tag order is skipping a provable no-op.
 *
 * If tag handling ever becomes order-sensitive — a "primary tag" at index 0,
 * say — this normalisation becomes wrong and must be dropped in the same
 * change.
 */
function canonicalTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags)].sort();
}

/**
 * A stable digest of "who this is and what we know about them".
 *
 * Key-order independent at every level, including the nested `device` object,
 * because `canonicalJson` sorts keys wherever it finds them. Two calls with
 * the same `userId` and an equivalent profile produce the same string; any
 * changed, added, or removed field produces a different one.
 *
 * `userId` is folded in rather than kept beside the hash so that a different
 * user reading a stored fingerprint can never match it. See the storage-key
 * note on {@link shouldSyncIdentity} for why that matters.
 */
export function profileFingerprint(userId: string, profile: IdentityProfile): string {
  const { tags, ...rest } = profile;

  return fnv1a64Hex(
    canonicalJson({
      userId,
      profile: tags === undefined ? rest : { ...rest, tags: canonicalTags(tags) },
    }),
  );
}

// ---------------------------------------------------------------------------
// TTL gate
// ---------------------------------------------------------------------------

/**
 * How long a successful identify suppresses the next one, per spec §7.3.
 *
 * Named rather than inlined so the tradeoff has one place to be retuned: this
 * value is also the resolution cap on `lastLoginAt`. A user active for an hour
 * refreshes their last-login four times, not once per navigation — the same
 * granularity every mainstream analytics SDK's `identify` produces, and an
 * accepted, documented choice rather than a gap.
 */
export const IDENTITY_DEDUP_TTL_MS = 15 * 60_000;

/**
 * The one `StorageAdapter` key this module owns.
 *
 * Named like `queue/types.ts`'s `DEFAULT_STORAGE_KEY` ('sendQueue'), and — as
 * there — expected to sit under whatever namespace the host wrapped the
 * adapter in.
 *
 * ONE key for all users rather than one per user. A second user on a shared
 * device overwrites the first user's record, so when the first returns their
 * fingerprint no longer matches (`userId` is folded into it) and they
 * re-identify. That is a redundant call, which is the harmless direction, and
 * it buys a hard bound on how much of the shared quota this feature can ever
 * take: one record, forever.
 */
const DEDUP_STORAGE_KEY = 'identitySync';

/** What {@link recordIdentitySynced} persists and {@link shouldSyncIdentity} reads back. */
interface DedupRecord {
  readonly fingerprint: string;
  readonly syncedAt: number;
}

/** Everything both halves of the gate need to identify the profile in question. */
export interface IdentityDedupOptions {
  readonly storage: StorageAdapter;
  /** The logged-in user's id — `localSender.senderId` at the call site. */
  readonly userId: string;
  readonly profile: IdentityProfile;
  /** Injected per `ChatClientConfig.now`. Never `Date.now()` directly. */
  readonly now: Clock;
}

/**
 * Reads the stored record, or `null` for anything that is not a record we
 * wrote and can still trust.
 *
 * Every failure mode collapses to the same `null`: a rejected read, absent
 * key, malformed JSON, wrong shape, non-finite timestamp. They differ in
 * cause and not in consequence — in all of them we do not know when this
 * profile was last synced, and the only safe answer to "do we know?" is no.
 *
 * The rejected-read case is the one that matters and the one
 * `StorageAdapter`'s own contract calls out: "A rejection means 'unknown',
 * NOT 'absent'". Both are handled here, but they are handled by *sending*,
 * never by skipping — see {@link shouldSyncIdentity}.
 */
async function readDedupRecord(storage: StorageAdapter): Promise<DedupRecord | null> {
  let raw: string | null;

  try {
    raw = await storage.get(DEDUP_STORAGE_KEY);
  } catch {
    return null;
  }

  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const { fingerprint, syncedAt } = parsed as {
    readonly fingerprint?: unknown;
    readonly syncedAt?: unknown;
  };

  if (typeof fingerprint !== 'string') return null;
  if (typeof syncedAt !== 'number' || !Number.isFinite(syncedAt)) return null;

  return { fingerprint, syncedAt };
}

/**
 * Whether this profile should be sent now, or is already covered by a recent
 * successful sync.
 *
 * Resolves `true` (send) for every uncertainty, and `false` (skip) only when
 * we positively know a matching profile was synced within
 * {@link IDENTITY_DEDUP_TTL_MS}. That asymmetry is the whole safety argument:
 * a wrong `true` costs one redundant, idempotent POST, while a wrong `false`
 * silently loses a CRM update the host asked for. Storage that rejects,
 * storage that was cleared, and storage holding something we cannot parse all
 * therefore land on `true`.
 *
 * No storage failure can make this reject — that is the guarantee the caller
 * relies on, and it holds for a rejecting `get`, a cleared store, and a
 * corrupt record alike. It is deliberately NOT extended to a profile that
 * cannot be serialised at all (a circular object, reachable only from untyped
 * JS): that is a bug in the host's integration which `JSON.stringify` would
 * hit again at the wire, and it should surface rather than be swallowed into a
 * silent "send" that then fails anyway.
 */
export async function shouldSyncIdentity(options: IdentityDedupOptions): Promise<boolean> {
  const record = await readDedupRecord(options.storage);
  if (record === null) return true;

  if (record.fingerprint !== profileFingerprint(options.userId, options.profile)) {
    // A real profile change does not wait out a stale window (§7.3).
    return true;
  }

  const age = options.now() - record.syncedAt;

  // `age < 0` is a record stamped in the future: the device clock moved
  // backwards, or storage was seeded by something other than this module.
  // Trusting it would suppress identify until real time caught up, which for a
  // badly-set clock could be years. Treat it as unknown and send.
  return age < 0 || age >= IDENTITY_DEDUP_TTL_MS;
}

/**
 * Records that this exact profile synced successfully at `now()`, starting a
 * fresh TTL window. Call only after the sync actually succeeded.
 *
 * No storage failure can make this reject. A failed write is not worth
 * surfacing anywhere, because its only consequence is that the next
 * construction re-sends — the same harmless direction
 * {@link shouldSyncIdentity} already degrades to. Letting it reject would
 * instead push an unhandled rejection out of a fire-and-forget path whose
 * entire contract is that nothing user-visible waits on it. As above, an
 * unserialisable profile is the one thing that still throws.
 */
export async function recordIdentitySynced(options: IdentityDedupOptions): Promise<void> {
  const record: DedupRecord = {
    fingerprint: profileFingerprint(options.userId, options.profile),
    syncedAt: options.now(),
  };

  try {
    await options.storage.set(DEDUP_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Intentionally swallowed — see the doc comment above.
  }
}
