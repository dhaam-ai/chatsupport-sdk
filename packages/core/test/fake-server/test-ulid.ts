// Minimal test-only ULID-shaped id generator.
//
// NOT a real ULID implementation (no monotonicity guarantee, no spec
// compliance beyond shape) — it exists purely to produce ids that satisfy
// protocol/validate.ts's `isValidUlid` (26 chars, Crockford base32,
// uppercase) for constructing test frames and fake-server-assigned frame
// ids. Real ULID generation is out of scope for this test harness.

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBase32Chars(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CROCKFORD_BASE32.charAt(Math.floor(Math.random() * CROCKFORD_BASE32.length));
  }
  return out;
}

/** Returns a fresh 26-character Crockford-base32 string shaped like a ULID. */
export function testUlid(): string {
  return randomBase32Chars(26);
}
