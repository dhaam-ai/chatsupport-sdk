/// CSAT — `POST` and `GET /chat/sessions/{id}/csat`.
library;

import '../internal/json_reading.dart';

/// `POST .../csat`'s response, field for field.
class RestCsatSubmission {
  const RestCsatSubmission({
    required this.sessionId,
    required this.rating,
    required this.comment,
    required this.submittedAt,
  });

  factory RestCsatSubmission.fromJson(
    Map<String, Object?> json,
    String context,
  ) =>
      RestCsatSubmission(
        sessionId:
            requireNonEmptyString(json, 'sessionId', 'csat', context: context),
        rating: requireInt(json, 'rating', 'csat', context: context),
        comment: optionalString(json, 'comment'),
        submittedAt:
            requireTimestamp(json, 'submittedAt', 'csat', context: context),
      );

  final String sessionId;

  /// 1–5. Decoded leniently the same way `dhaam_chat`'s `requireInt` is, since
  /// Flutter Web represents every JSON number as a Dart `double`.
  final int rating;

  /// `null` when the customer left none.
  ///
  /// Normalized from an absent OR an explicit-null wire value: the route
  /// documents `string | null`, and a caller distinguishing "absent" from
  /// "explicitly empty" here would be reading a difference the server does not
  /// make.
  final String? comment;

  final DateTime submittedAt;
}

/// `GET .../csat` — whether THIS session already carries a rating.
///
/// Sealed rather than nullable, mirroring the route's own discriminated pair
/// (`{rated: false} | {rated: true, …}`). This is Dart's idiom for exactly
/// that shape and matches `RetryOutcome` and `ServerFrame`'s own unions in
/// `dhaam_chat`.
///
/// The point of the union is that "not rated yet" is an ANSWER, not an absence
/// — a fact about a session the customer owns, returned as a `200`, never a
/// 404. A nullable return would collapse it into the same value as a failed
/// lookup, and a caller that cannot tell those apart will offer the survey
/// again on exactly the case this route exists to prevent.
sealed class RestCsatStatus {
  const RestCsatStatus();

  /// Decodes `data` from a `GET …/csat` envelope.
  ///
  /// Strict on purpose, in both directions:
  ///
  ///  * a missing or non-boolean `rated` throws, rather than being read as
  ///    unrated — reading a malformed body as "no rating yet" would re-offer
  ///    the survey and destroy a rating the customer already gave;
  ///  * `rated: true` with no numeric `rating` throws, because a "locked" card
  ///    with nothing in it is exactly as broken as losing the rating.
  factory RestCsatStatus.fromJson(Map<String, Object?> json, String context) {
    if (!requireBool(json, 'rated', 'csat', context: context)) {
      return const RestCsatUnrated();
    }

    return RestCsatRated(
      rating: requireInt(json, 'rating', 'csat', context: context),
      comment: optionalString(json, 'comment'),
      // Unlike RestCsatSubmission.submittedAt, this one is genuinely optional:
      // the GET route is not documented to always carry it.
      submittedAt: optionalTimestamp(json, 'submittedAt'),
    );
  }
}

/// The session carries no rating yet. A normal answer, not a failure.
final class RestCsatUnrated extends RestCsatStatus {
  const RestCsatUnrated();
}

/// The session has already been rated.
final class RestCsatRated extends RestCsatStatus {
  const RestCsatRated({
    required this.rating,
    required this.comment,
    this.submittedAt,
  });

  final int rating;
  final String? comment;

  /// `null` ONLY if the service omitted it — unlike
  /// [RestCsatSubmission.submittedAt], which the submit response always
  /// carries.
  final DateTime? submittedAt;
}
