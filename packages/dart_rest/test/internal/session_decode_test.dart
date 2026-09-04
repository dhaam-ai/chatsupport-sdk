/// Reproduces `projection.test.ts`'s `describe('toChatSession')`.
library;

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_rest/src/errors.dart';
import 'package:dhaam_chat_rest/src/internal/session_decode.dart';
import 'package:dhaam_chat_rest/src/models/session.dart';
import 'package:test/test.dart';

const String _ctx = 'GET /chat/sessions/{sessionId}/full';

/// Mirrors `projection.test.ts`'s `sessionRow` field for field, including the
/// row fields nothing models (`tenantId`, `priority`, `updatedAt`) — they are
/// there precisely so the decoder can be seen to drop them.
Map<String, Object?> sessionRow([Map<String, Object?> overrides = const {}]) =>
    <String, Object?>{
      'id': 's1',
      'tenantId': 't1',
      'customerId': 'cust-1',
      'assignedAgentId': 'agent-9',
      'ticketId': null,
      'mode': 2,
      'status': 3,
      'priority': 2,
      'closedAt': null,
      'createdAt': '2026-08-19T09:00:00.000Z',
      'updatedAt': '2026-08-19T09:30:00.000Z',
      ...overrides,
    };

void main() {
  group('decodeRestChatSession', () {
    test('decodes the integer status and mode', () {
      final RestChatSession open = decodeRestChatSession(
        sessionRow(<String, Object?>{'status': 1, 'mode': 1}),
        _ctx,
      );
      expect(open.status, ChatStatus.open);
      expect(open.mode, ChatMode.bot);

      final RestChatSession held = decodeRestChatSession(
        sessionRow(<String, Object?>{'status': 6, 'mode': 2}),
        _ctx,
      );
      expect(held.status, ChatStatus.onHold);
      expect(held.mode, ChatMode.human);
    });

    for (final (int wire, ChatStatus expected) in <(int, ChatStatus)>[
      (1, ChatStatus.open),
      (2, ChatStatus.waitingForAgent),
      (3, ChatStatus.assigned),
      (4, ChatStatus.closed),
      (5, ChatStatus.resolved),
      (6, ChatStatus.onHold),
    ]) {
      test('decodes status $wire to ${expected.wire}', () {
        // All SIX. v1 modelled four and collapsed RESOLVED and ON_HOLD into
        // OPEN, which is the bug this table exists to not re-introduce.
        expect(
          decodeRestChatSession(
                  sessionRow(<String, Object?>{'status': wire}), _ctx)
              .status,
          expected,
        );
      });
    }

    test('rejects an unmappable status or mode', () {
      expect(
        () => decodeRestChatSession(
            sessionRow(<String, Object?>{'status': 99}), _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
      expect(
        () => decodeRestChatSession(
            sessionRow(<String, Object?>{'mode': 0}), _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('synthesizes participantId from the outer row, which enrichment omits',
        () {
      // enrichSessionWithUsers returns {displayName,email,avatarUrl,isOnline}
      // and no id, but presence and read watermarks are keyed by participantId.
      final RestChatSession session = decodeRestChatSession(
        sessionRow(<String, Object?>{
          'assignedAgent': <String, Object?>{
            'displayName': 'Ada',
            'email': 'ada@x.test',
            'avatarUrl': null,
            'isOnline': true,
          },
          'customer': <String, Object?>{
            'displayName': 'Bob',
            'email': null,
            'avatarUrl': 'https://x.test/b.png',
          },
        }),
        _ctx,
      );

      expect(session.assignedAgent?.participantId, 'agent-9');
      expect(session.assignedAgent?.displayName, 'Ada');
      expect(session.assignedAgent?.email, isNull);
      expect(session.assignedAgent?.avatarUrl, isNull);

      expect(session.customer?.participantId, 'cust-1');
      expect(session.customer?.displayName, 'Bob');
      expect(session.customer?.email, isNull);
      expect(session.customer?.avatarUrl, 'https://x.test/b.png');
    });

    test('never copies an email through, even when /full returns one', () {
      // The WS path always writes null and nothing in the SDK renders this.
      // The widget runs inside third-party pages whose session-replay tools
      // serialize application state wholesale.
      final RestChatSession session = decodeRestChatSession(
        sessionRow(<String, Object?>{
          'assignedAgent': <String, Object?>{
            'displayName': 'Ada',
            'email': 'ada@private.test',
            'avatarUrl': null,
          },
          'customer': <String, Object?>{
            'displayName': 'Bob',
            'email': 'bob@private.test',
            'avatarUrl': null,
          },
        }),
        _ctx,
      );

      expect(session.assignedAgent?.email, isNull);
      expect(session.customer?.email, isNull);
    });

    test('falls back to the id when enrichment resolved no display name', () {
      final RestChatSession session = decodeRestChatSession(
        sessionRow(<String, Object?>{
          'assignedAgent': <String, Object?>{'displayName': null},
        }),
        _ctx,
      );

      expect(session.assignedAgent?.displayName, 'agent-9');
    });

    test('returns a null profile when there is no id to correlate presence by',
        () {
      final RestChatSession session = decodeRestChatSession(
        sessionRow(<String, Object?>{
          'assignedAgentId': null,
          'assignedAgent': <String, Object?>{
            'displayName': 'Ghost',
            'email': null,
            'avatarUrl': null,
          },
        }),
        _ctx,
      );

      expect(session.assignedAgent, isNull);
    });

    test('returns a null profile when enrichment found no user', () {
      // chat-user.service swallows its own failure and leaves these null.
      final RestChatSession session = decodeRestChatSession(
        sessionRow(<String, Object?>{
          'assignedAgent': null,
          'customer': null,
        }),
        _ctx,
      );

      expect(session.customer, isNull);
      expect(session.assignedAgent, isNull);
    });

    test('maps the bare ticketId onto the ticket shape', () {
      final RestChatSession withTicket = decodeRestChatSession(
        sessionRow(<String, Object?>{'ticketId': 'TICK-1'}),
        _ctx,
      );

      expect(withTicket.ticket?.id, 'TICK-1');
      expect(withTicket.ticket?.url, isNull);
      expect(
        decodeRestChatSession(
                sessionRow(<String, Object?>{'ticketId': null}), _ctx)
            .ticket,
        isNull,
      );
    });

    test('keeps closedAt null while open and a DateTime once closed', () {
      expect(decodeRestChatSession(sessionRow(), _ctx).closedAt, isNull);
      expect(
        decodeRestChatSession(
          sessionRow(<String, Object?>{
            'status': 4,
            'closedAt': '2026-08-19T11:00:00.000Z',
          }),
          _ctx,
        ).closedAt,
        DateTime.utc(2026, 8, 19, 11),
      );
    });

    test('reads a timestamp from epoch millis as well as an ISO string', () {
      // The cache-miss shape (contract §5.1) — the same leniency the message
      // decoder needs, asserted on this route too because it is a separate
      // call site.
      expect(
        decodeRestChatSession(
          sessionRow(<String, Object?>{'createdAt': 1755594000000}),
          _ctx,
        ).createdAt,
        DateTime.fromMillisecondsSinceEpoch(1755594000000, isUtc: true),
      );
    });

    test('rejects a row with no id and a non-object row', () {
      expect(
        () => decodeRestChatSession(
            sessionRow(<String, Object?>{'id': null}), _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
      expect(
        () => decodeRestChatSession(null, _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
      expect(
        () => decodeRestChatSession(<Object?>[sessionRow()], _ctx),
        throwsA(isA<RestMalformedResponseException>()),
      );
    });

    test('the fromJson factory is the same decode', () {
      // The contract puts a `fromJson` on the model and the logic in
      // internal/; this pins that the public entry point actually reaches it.
      final RestChatSession viaFactory =
          RestChatSession.fromJson(sessionRow(), _ctx);

      expect(viaFactory.id, 's1');
      expect(viaFactory.status, ChatStatus.assigned);
      expect(viaFactory.mode, ChatMode.human);
    });

    test('fromEnrichedBlock is reachable from the model too', () {
      final RestChatParticipantProfile? profile =
          RestChatParticipantProfile.fromEnrichedBlock(
        <String, Object?>{'displayName': 'Ada'},
        'agent-9',
      );

      expect(profile?.participantId, 'agent-9');
      expect(profile?.displayName, 'Ada');
    });
  });
}
