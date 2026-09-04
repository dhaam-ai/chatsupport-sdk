/// `RestIssueReport`'s body shape.
///
/// No TypeScript test to reproduce: `@dhaam-ccrm/rest` never modeled this
/// route, and `widget.ts` issues it raw with no wire-level coverage on either
/// side. T14 owns `RestClient.reportIssue`; this is the first contract-level
/// assertion the request body has ever had.
library;

import 'package:dhaam_chat_rest/src/models/issue_report.dart';
import 'package:test/test.dart';

void main() {
  group('RestIssueReport.toJson', () {
    test('sends subject and details', () {
      expect(
        const RestIssueReport(
          subject: 'Cannot upload a photo',
          details: 'The spinner never stops.',
        ).toJson(),
        <String, Object?>{
          'subject': 'Cannot upload a photo',
          'details': 'The spinner never stops.',
        },
      );
    });

    test('includes contactEmail when the customer supplied one', () {
      expect(
        const RestIssueReport(
          subject: 's',
          details: 'd',
          contactEmail: 'jordan@example.com',
        ).toJson()['contactEmail'],
        'jordan@example.com',
      );
    });

    test('omits contactEmail entirely when null', () {
      // Load-bearing rather than tidy: the route runs its own .email() check
      // on this field, and an empty or null value fails it for no reason — a
      // customer who chose not to leave an address would have their whole
      // report rejected.
      expect(
        const RestIssueReport(subject: 's', details: 'd')
            .toJson()
            .containsKey('contactEmail'),
        isFalse,
      );
    });

    test('carries neither a tenant nor a session id', () {
      // The tenant comes from the verified token and the session is in the
      // path. Sending either is a 400, which is why neither is a field.
      final Map<String, Object?> body =
          const RestIssueReport(subject: 's', details: 'd').toJson();

      expect(body.keys.toSet(), <String>{'subject', 'details'});
    });
  });
}
