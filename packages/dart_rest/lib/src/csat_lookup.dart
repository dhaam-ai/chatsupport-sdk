/// The bridge from `GET …/csat` to `dhaam_chat`'s CSAT machine.
///
/// ── Why this is here and not in `packages/flutter` ────────────────────────
///
/// `CsatMachine` takes a [CsatLookupFn] and deliberately never learns a URL, a
/// header or a status code — that is what keeps `dhaam_chat` free of HTTP.
/// Something has to close that gap, and there is exactly one place that can
/// see both halves: this package already depends on `dhaam_chat` (so it can
/// name [CsatStatus] and [CsatRouteMissing]) and already owns
/// [RestApiException] (so it can read a status and a code). `packages/flutter`
/// can do neither — it does not depend on this package at all, by design.
///
/// ── And why it is not left to each host ───────────────────────────────────
///
/// The whole content of this file is one call to
/// [CsatRouteMissing.describes], and that call is the difference between two
/// failures that must be treated OPPOSITELY:
///
///  * a framework route-not-found (`HTTP_404`/`HTTP_405`, no envelope) means
///    this DEPLOYMENT has no CSAT read route, and the survey is still offered
///    — there is no stored rating for it to overwrite;
///  * an ownership failure carries chat-service's own envelope, so the code is
///    `SESSION_NOT_FOUND`, and that is an answer ABOUT THIS SESSION. It
///    withholds the survey like any other unknown, because `POST …/csat` is an
///    upsert and offering a survey over a session whose rating is unknown
///    risks replacing a score the customer already gave.
///
/// A host writing that check by hand gets it wrong in one direction or the
/// other, and both directions are silent. Shipping the one adapter is what
/// makes the rule unrepeatable rather than merely written down.
library;

import 'package:dhaam_chat/dhaam_chat.dart'
    show CsatLookupFn, CsatRated, CsatRouteMissing, CsatStatus, CsatUnrated;

import 'client.dart';
import 'errors.dart';
import 'models/csat.dart';
import 'sessions.dart';

/// A [CsatLookupFn] over [SessionApi.getCsat], ready to hand to a
/// `CsatMachine`.
///
/// ```dart
/// final machine = CsatMachine(lookup: csatLookupOver(rest));
/// ```
///
/// Every failure other than a missing route propagates unchanged, and that is
/// deliberate: the machine records those as `unknown` and WITHHOLDS the
/// survey. In particular a [RestMalformedResponseException] — which
/// [RestCsatStatus.fromJson] raises for a non-boolean `rated`, or `rated:
/// true` with no numeric rating — must never be softened into
/// [CsatUnrated] here. Reading "we do not understand this body" as "nobody has
/// rated it" re-offers the survey over the exact case the read route exists to
/// prevent.
CsatLookupFn csatLookupOver(RestClient client) {
  return (String sessionId) async {
    final RestCsatStatus status;
    try {
      status = await client.getCsat(sessionId);
    } on RestApiException catch (error) {
      // The one rule, called rather than re-derived. `describes` accepts only
      // the literal `HTTP_<status>` code, which is what the transport
      // synthesizes when a body carried no structured error at all — so an
      // enveloped `SESSION_NOT_FOUND` on a 404 falls through and stays an
      // ordinary failure.
      if (CsatRouteMissing.describes(status: error.status, code: error.code)) {
        throw const CsatRouteMissing();
      }
      rethrow;
    }

    // Exhaustive over the sealed pair, so a third wire shape would be a
    // compile error here rather than a silent default.
    return switch (status) {
      RestCsatUnrated() => const CsatUnrated(),
      RestCsatRated(:final int rating, :final String? comment) =>
        CsatRated(rating: rating, comment: comment),
    };
  };
}
