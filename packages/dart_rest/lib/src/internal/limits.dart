/// Client-side range checks that run BEFORE a request is made.
///
/// Left here by T1 for the endpoint methods to call, so that "validated
/// locally, no request made" has one implementation rather than one per
/// caller.
library;

import '../client.dart' show kSessionSummaryLimitMax, kSessionSummaryLimitMin;
import '../errors.dart';

/// Validates `limit` for `GET /chat/sessions/customer`.
///
/// A `null` limit is valid and means "omit the parameter entirely", deferring
/// to the server's own default of 5 — not "send `limit=null`".
///
/// Throws [RestValidationException] outside [kSessionSummaryLimitMin]..
/// [kSessionSummaryLimitMax]. The TYPE is the point: it states that no network
/// activity happened, which TS spells with a `status: 0` sentinel on an
/// otherwise-ordinary API error (contract §5.3). A caller checking
/// `error is RestValidationException` never has to learn that `0` is special.
///
/// ── Two of TS's five cases are unwritable in Dart ─────────────────────────
///
/// `client.test.ts` drives this with `it.each([0, 21, 1.5, -1, NaN])`. Dart's
/// `int` cannot hold `1.5` or `NaN`, so those two states are compile-time
/// impossible here and there is nothing for a test to assert — the equivalent
/// test covers `[0, 21, -1]` only. That is not a gap in coverage; it is the
/// same guarantee, enforced one layer earlier by the type system instead of at
/// runtime (contract §5.5). The `Number.isInteger` half of TS's guard
/// disappears for the same reason.
void validateSessionSummaryLimit(int? limit) {
  if (limit == null) return;
  if (limit < kSessionSummaryLimitMin || limit > kSessionSummaryLimitMax) {
    // The caller's own value is safe to name: it came from the caller, not
    // from the wire. This is the one place in the package where echoing an
    // input is not a leak — and saying which bound was missed is what makes
    // the message actionable.
    throw RestValidationException(
      'limit must be between $kSessionSummaryLimitMin and '
      '$kSessionSummaryLimitMax, got $limit',
    );
  }
}
