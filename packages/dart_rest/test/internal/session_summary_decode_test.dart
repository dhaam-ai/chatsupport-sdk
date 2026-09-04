/// Reproduces `projection.test.ts`'s `toChatSessionSummary — string enums`,
/// `— full mapping` and `projectSessionSummaryRow` blocks.
library;

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/internal/session_summary_decode.dart';
import 'package:dhaam_chat_rest/src/models/session_summary.dart';
import 'package:test/test.dart';

const String _ctx = 'GET /chat/sessions/customer';

/// A `sessions[]` item as the route actually returns it — v2 string enums.
Map<String, Object?> summaryRow([Map<String, Object?> overrides = const {}]) =>
    <String, Object?>{
      'id': 'sum-1',
      'status': 'ASSIGNED',
      'mode': 'HUMAN',
      'createdAt': '2026-08-19T09:00:00.000Z',
      'closedAt': null,
      'lastMessageAt': '2026-08-19T09:05:00.000Z',
      'lastMessagePreview': 'here you go',
      'unreadCount': 3,
      'subject': 'Order never arrived',
      'topic': 'Delivery issue',
      'handledBy': <String, Object?>{
        'kind': 'AGENT',
        'id': 'agent-9',
        'displayName': 'Ada',
      },
      ...overrides,
    };

void main() {
  group('decodeRestChatSessionSummary — string enums, already v2-projected',
      () {
    for (final ChatStatus status in ChatStatus.values) {
      test('accepts status ${status.wire} verbatim', () {
        expect(
          decodeRestChatSessionSummary(
            summaryRow(<String, Object?>{'status': status.wire}),
            _ctx,
          ).status,
          status,
        );
      });
    }

    for (final ChatMode mode in ChatMode.values) {
      test('accepts mode ${mode.wire} verbatim', () {
        expect(
          decodeRestChatSessionSummary(
            summaryRow(<String, Object?>{'mode': mode.wire}),
            _ctx,
          ).mode,
          mode,
        );
      });
    }

    test('rejects an unmappable status or mode rather than guessing', () {
      expect(
        () => decodeRestChatSessionSummary(
            summaryRow(<String, Object?>{'status': 'BOGUS'}), _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
      expect(
        () => decodeRestChatSessionSummary(
            summaryRow(<String, Object?>{'mode': 'BOGUS'}), _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('refuses the raw-row INTEGER form on this projected route', () {
      // This route already sends v2 strings, so a stray integer would mean the
      // raw-row shape had leaked onto a projected route — exactly as
      // unmappable as a bogus string, and refused identically.
      expect(
        () => decodeRestChatSessionSummary(
            summaryRow(<String, Object?>{'status': 3}), _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });
  });

  group('decodeRestChatSessionSummary — full mapping', () {
    test('parses every field, including subject/topic and handledBy', () {
      final RestChatSessionSummary summary =
          decodeRestChatSessionSummary(summaryRow(), _ctx);

      expect(summary.id, 'sum-1');
      expect(summary.status, ChatStatus.assigned);
      expect(summary.mode, ChatMode.human);
      expect(summary.createdAt, DateTime.utc(2026, 8, 19, 9));
      expect(summary.closedAt, isNull);
      expect(summary.lastMessageAt, DateTime.utc(2026, 8, 19, 9, 5));
      expect(summary.lastMessagePreview, 'here you go');
      expect(summary.unreadCount, 3);
      expect(summary.subject, 'Order never arrived');
      expect(summary.topic, 'Delivery issue');
      expect(summary.handledBy?.kind, HandledByKind.agent);
      expect(summary.handledBy?.id, 'agent-9');
      expect(summary.handledBy?.displayName, 'Ada');
    });

    test('parses a BOT handledBy the same way as an AGENT one', () {
      // Not an edge case: the bot resuming a session after a human agent
      // leaves arrives with kind BOT.
      final RestChatSessionSummary summary = decodeRestChatSessionSummary(
        summaryRow(<String, Object?>{
          'handledBy': <String, Object?>{
            'kind': 'BOT',
            'id': 'bot',
            'displayName': 'Assistant',
          },
        }),
        _ctx,
      );

      expect(summary.handledBy?.kind, HandledByKind.bot);
      expect(summary.handledBy?.displayName, 'Assistant');
    });

    test('keeps optional fields null when the wire omits them', () {
      final Map<String, Object?> row = summaryRow();
      row.remove('lastMessagePreview');
      row.remove('subject');
      row.remove('topic');
      row.remove('handledBy');

      final RestChatSessionSummary summary =
          decodeRestChatSessionSummary(row, _ctx);

      expect(summary.lastMessagePreview, isNull);
      expect(summary.subject, isNull);
      expect(summary.topic, isNull);
      expect(summary.handledBy, isNull);
      // The required fields still landed.
      expect(summary.id, 'sum-1');
      expect(summary.unreadCount, 3);
    });

    test('treats an empty-string preview/subject/topic as absent', () {
      final RestChatSessionSummary summary = decodeRestChatSessionSummary(
        summaryRow(<String, Object?>{
          'lastMessagePreview': '',
          'subject': '',
          'topic': '',
        }),
        _ctx,
      );

      expect(summary.lastMessagePreview, isNull);
      expect(summary.subject, isNull);
      expect(summary.topic, isNull);
    });

    test('accepts subject without topic and vice versa', () {
      final RestChatSessionSummary subjectOnly = decodeRestChatSessionSummary(
        summaryRow(<String, Object?>{'topic': null}),
        _ctx,
      );
      expect(subjectOnly.subject, 'Order never arrived');
      expect(subjectOnly.topic, isNull);

      final RestChatSessionSummary topicOnly = decodeRestChatSessionSummary(
        summaryRow(<String, Object?>{'subject': null}),
        _ctx,
      );
      expect(topicOnly.topic, 'Delivery issue');
      expect(topicOnly.subject, isNull);
    });

    test(
        'keeps closedAt and lastMessageAt null rather than treating null as a '
        'parse failure', () {
      final RestChatSessionSummary summary = decodeRestChatSessionSummary(
        summaryRow(<String, Object?>{
          'closedAt': null,
          'lastMessageAt': null,
        }),
        _ctx,
      );

      expect(summary.closedAt, isNull);
      expect(summary.lastMessageAt, isNull);
    });

    for (final (String label, Object? unreadCount) in <(String, Object?)>[
      ('negative', -1),
      ('a numeric string', '3'),
      ('absent', null),
    ]) {
      test('requires unreadCount — rejects $label', () {
        expect(
          () => decodeRestChatSessionSummary(
            summaryRow(<String, Object?>{'unreadCount': unreadCount}),
            _ctx,
          ),
          throwsA(isA<RestMalformedResponseException>()),
        );
      });
    }

    test('accepts unreadCount 0 as a normal, present value', () {
      expect(
        decodeRestChatSessionSummary(
          summaryRow(<String, Object?>{'unreadCount': 0}),
          _ctx,
        ).unreadCount,
        0,
      );
    });

    for (final (String label, Object? handledBy) in <(String, Object?)>[
      ('is missing its id and displayName', <String, Object?>{'kind': 'AGENT'}),
      (
        'has an unrecognized kind',
        <String, Object?>{'kind': 'BOGUS', 'id': 'x', 'displayName': 'x'}
      ),
      // CUSTOMER specifically: a customer is who a session is FOR, never who
      // handles it. HandledByKind refuses it, and reusing that enum is what
      // makes the refusal free here.
      (
        'names CUSTOMER as the handler',
        <String, Object?>{'kind': 'CUSTOMER', 'id': 'x', 'displayName': 'x'}
      ),
      (
        'has an empty displayName',
        <String, Object?>{'kind': 'AGENT', 'id': 'a', 'displayName': ''}
      ),
      ('is not an object', 'AGENT'),
      ('is an array', <Object?>[]),
    ]) {
      test('drops a handledBy that $label rather than failing the summary', () {
        // handledBy is additive information the picker does not depend on — a
        // bad one must not cost the rest of an otherwise-good row.
        final RestChatSessionSummary summary = decodeRestChatSessionSummary(
          summaryRow(<String, Object?>{'handledBy': handledBy}),
          _ctx,
        );

        expect(summary.handledBy, isNull);
        expect(summary.id, 'sum-1');
        expect(summary.status, ChatStatus.assigned);
      });
    }

    test('the fromJson factory is the same decode', () {
      expect(
        RestChatSessionSummary.fromJson(summaryRow(), _ctx).id,
        'sum-1',
      );
    });
  });

  group('projectSessionSummaryRow', () {
    test('keeps every good row when one row cannot be decoded', () {
      // One forward-incompatible status must cost that one session, not the
      // customer's entire picker.
      final List<Map<String, Object?>> rows = <Map<String, Object?>>[
        summaryRow(<String, Object?>{'id': 's1'}),
        summaryRow(<String, Object?>{'id': 's2', 'status': 'BOGUS'}),
        summaryRow(<String, Object?>{'id': 's3'}),
      ];

      final List<RestChatSessionSummary?> projected = rows
          .map(
              (Map<String, Object?> row) => projectSessionSummaryRow(row, _ctx))
          .toList();

      expect(
        projected.map((RestChatSessionSummary? s) => s?.id).toList(),
        <String?>['s1', null, 's3'],
      );
    });

    test(
        'omits rather than replaces — unlike a message, which gets a '
        'placeholder', () {
      // The one place this package's two page-level projectors deliberately
      // differ. There is no "unsupported session" row a picker could render
      // that a customer would not simply tap.
      expect(
        projectSessionSummaryRow(
            summaryRow(<String, Object?>{'status': 'BOGUS'}), _ctx),
        isNull,
      );
    });

    test('returns the same value as the strict decode for a good row', () {
      expect(
        projectSessionSummaryRow(summaryRow(), _ctx)?.id,
        decodeRestChatSessionSummary(summaryRow(), _ctx).id,
      );
    });

    test('returns null for a row that is not an object at all', () {
      expect(projectSessionSummaryRow(null, _ctx), isNull);
      expect(projectSessionSummaryRow('nope', _ctx), isNull);
    });
  });
}
