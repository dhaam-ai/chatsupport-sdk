/// `POST /chat/sessions/{id}/report-issue`.
library;

/// The request body for `RestClient.reportIssue`.
///
/// Mirrors `IssueReport` from `packages/widget/src/ui/report-issue.ts` — the
/// closest TypeScript source, since `@dhaam-ccrm/rest` never modeled this
/// route at all. The widget issues it raw from `widget.ts`, and there is no
/// OpenAPI entry for it either.
///
/// The body carries neither a tenant nor a session id: the tenant comes from
/// the verified token and the session is in the path, per the route's own
/// stated rule. Sending either is rejected with a 400, which is why neither
/// appears as a field here.
class RestIssueReport {
  const RestIssueReport({
    required this.subject,
    required this.details,
    this.contactEmail,
  });

  final String subject;
  final String details;

  /// Omitted from the request body when `null`, the same convention
  /// `submitCsat`'s `comment` follows.
  ///
  /// The omission is load-bearing rather than tidy: the route runs its own
  /// `.email()` check on this field, and an empty string fails it for no
  /// reason — a customer who simply chose not to leave an address would have
  /// their whole report rejected. A caller holding an empty text field should
  /// pass `null`, not `''`.
  final String? contactEmail;

  Map<String, Object?> toJson() => <String, Object?>{
        'subject': subject,
        'details': details,
        if (contactEmail != null) 'contactEmail': contactEmail,
      };
}
