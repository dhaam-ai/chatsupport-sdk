// Real ULID generation — not explicitly named as its own plan.md task, but
// required for T7 (heartbeat frame ids) and T11 (D1: "the client-generated
// ULID IS the permanent message id") to function at all. Lives at the top
// level of `src/` rather than under `protocol/` because it produces values,
// not types/schema — `protocol/validate.ts`'s `isValidUlid` checks the same
// shape this module emits, but the two are deliberately not merged: a
// validator and a generator are different responsibilities that happen to
// agree on a format.
//
// Implements the actual ULID spec (https://github.com/ulid/spec): a 48-bit
// millisecond timestamp followed by 80 bits of randomness, both Crockford
// base32 encoded, 26 characters total. This matters beyond just satisfying
// `isValidUlid`'s shape check — ULIDs are lexicographically sortable by
// creation time, which is a real property D1 relies on being genuine, not
// just plausible-looking.

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTimestamp(ms: number): string {
  // 48 bits → 10 base32 characters (10 * 5 = 50 bits of capacity, the top 2
  // are always zero for any real-world millisecond timestamp).
  let remaining = ms;
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD_BASE32.charAt(remaining % 32) + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return bytes;
  }
  // Fallback for an environment with no Web Crypto global. Not
  // cryptographically strong, but a ULID's randomness component only needs
  // to make collisions practically impossible within the same millisecond,
  // not resist an adversary — see the spec linked above.
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function encodeRandomness(bytes: Uint8Array): string {
  // 80 bits (10 bytes) → 16 base32 characters, 5 bits at a time across a
  // byte boundary that doesn't align to 8 — tracked with a small bit buffer.
  //
  // `bitBuffer` is masked down to just its unconsumed bits after every byte.
  // Without that mask, already-emitted high bits would keep accumulating in
  // `bitBuffer` across all 10 bytes (up to 80 bits of state), and `<<`/`>>`/
  // `&` coerce their operands to 32-bit signed integers — past ~4 bytes the
  // buffer would silently overflow that range and start producing wrong
  // output instead of throwing, which is exactly the kind of bug that only
  // shows up as an intermittent bad ULID, not a test failure on the first try.
  let out = '';
  let bitBuffer = 0;
  let bitsInBuffer = 0;

  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte;
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      out += CROCKFORD_BASE32.charAt((bitBuffer >> bitsInBuffer) & 0x1f);
    }
    bitBuffer &= (1 << bitsInBuffer) - 1;
  }
  if (bitsInBuffer > 0) {
    out += CROCKFORD_BASE32.charAt((bitBuffer << (5 - bitsInBuffer)) & 0x1f);
  }
  return out;
}

/** Generates a fresh, spec-shaped, time-sortable ULID. */
export function generateUlid(now: number = Date.now()): string {
  return encodeTimestamp(now) + encodeRandomness(randomBytes(10));
}
