import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:test/test.dart';

import 'fakes.dart';

final PublishableKey testKey = PublishableKey.parse('dhp_${'test'}_abc123XYZ');

const String _serverUlid = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

String ackJson({int seq = 5}) => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'connection.ack',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'protocolVersion': 1,
        'seq': seq,
        'session': <String, Object?>{
          'sessionId': 's1',
          'status': 'OPEN',
          'mode': 'BOT',
          'participants': <Object?>[],
          'createdAt': '2026-08-19T10:00:00.000Z',
        },
      },
    });

String ackFor(String ref, {int seq = 6}) => jsonEncode(<String, Object?>{
      'v': 1,
      't': 'ack',
      'id': _serverUlid,
      'ref': ref,
      'ts': 1700000000000,
      'd': <String, Object?>{'ok': true, 'seq': seq},
    });

class Harness {
  Harness() {
    scheduler = FakeScheduler();
    client = ChatClient(
      wsUrl: Uri.parse('wss://example.test/v2'),
      publishableKey: testKey,
      getToken: () async => 'jwt',
      scheduler: scheduler,
      socketFactory: (Uri _) async {
        final FakeSocket socket = FakeSocket();
        sockets.add(socket);
        return socket;
      },
    );
  }

  late final FakeScheduler scheduler;
  late final ChatClient client;
  final List<FakeSocket> sockets = <FakeSocket>[];

  FakeSocket get socket => sockets.last;

  Future<void> connected() async {
    unawaited(client.connect());
    await flush();
    socket.deliver(ackJson());
    await flush();
  }
}

void main() {
  group('optimistic send (D1)', () {
    test('returns an echo whose id is already the permanent id', () async {
      final Harness harness = Harness();
      await harness.connected();

      final ChatMessage echo = harness.client.sendMessage('hello');

      expect(isValidUlid(echo.id), isTrue);
      expect(echo.delivery, equals(MessageDelivery.pending));
      expect(echo.seq, isNull);
      expect(echo.content, equals('hello'));

      // The id on the wire IS the id on the echo. There is no swap path.
      final Map<String, Object?> sent =
          jsonDecode(harness.socket.sent.last) as Map<String, Object?>;
      expect(sent['id'], equals(echo.id));
      expect(sent['t'], equals('message.send'));

      await harness.client.dispose();
    });

    test('confirms the same id on ack, never a different one', () async {
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('hi');
      await flush();
      harness.socket.deliver(ackFor(echo.id, seq: 6));
      await flush();

      expect(seen, hasLength(2));
      expect(seen[0].id, equals(echo.id));
      expect(seen[1].id, equals(echo.id));
      expect(seen[0].delivery, equals(MessageDelivery.pending));
      expect(seen[1].delivery, equals(MessageDelivery.confirmed));
      expect(seen[1].seq, equals(6));

      await harness.client.dispose();
    });

    test('sends type on the wire even for a plain text message', () async {
      final Harness harness = Harness();
      await harness.connected();
      harness.client.sendMessage('hi');

      final Map<String, Object?> sent =
          jsonDecode(harness.socket.sent.last) as Map<String, Object?>;
      final Map<String, Object?> d = sent['d']! as Map<String, Object?>;
      expect(d['type'], equals('TEXT'));
      expect(sent['ts'], isA<int>());

      await harness.client.dispose();
    });

    test('ids of successive sends sort in send order', () async {
      // Within one millisecond the fake clock never advances, so only the
      // monotonic ULID keeps these ordered.
      final Harness harness = Harness();
      await harness.connected();

      final List<String> ids = <String>[
        for (int i = 0; i < 50; i++) harness.client.sendMessage('m$i').id,
      ];
      expect(ids, equals(List<String>.of(ids)..sort()));

      await harness.client.dispose();
    });

    test('holds a send when the socket is not connected', () async {
      // §6.3: sending never throws for "offline", because offline is a QUEUED
      // state and not a failure. The echo says so, so a host renders a clock
      // rather than a warning triangle, and the composer stays usable.
      final Harness harness = Harness();
      final ChatMessage echo = harness.client.sendMessage('offline');

      expect(echo.delivery, equals(MessageDelivery.queued));
      expect(harness.client.queuedCount, equals(1));

      await harness.client.dispose();
    });

    test('marks a send failed when the server rejects it', () async {
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      final ChatMessage echo = harness.client.sendMessage('hi');
      await flush();
      harness.socket.deliver(jsonEncode(<String, Object?>{
        'v': 1,
        't': 'ack',
        'id': _serverUlid,
        'ref': echo.id,
        'ts': 1700000000000,
        'd': <String, Object?>{
          'ok': false,
          'error': <String, Object?>{
            'code': 'RATE_LIMITED',
            'message': 'slow down',
            'retryable': true,
          },
        },
      }));
      await flush();

      expect(seen.last.delivery, equals(MessageDelivery.failed));
      expect(seen.last.id, equals(echo.id));

      await harness.client.dispose();
    });
  });

  group('inbound routing', () {
    test('emits server messages with their seq', () async {
      final Harness harness = Harness();
      await harness.connected();

      final List<ChatMessage> seen = <ChatMessage>[];
      harness.client.messages.listen(seen.add);

      harness.socket.deliver(jsonEncode(<String, Object?>{
        'v': 1,
        't': 'message.new',
        'id': _serverUlid,
        'ts': 1700000000000,
        'd': <String, Object?>{
          'id': '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          'sessionId': 's1',
          'senderId': 'agent-1',
          'senderType': 'AGENT',
          'type': 'TEXT',
          'content': 'hello back',
          'seq': 6,
          'createdAt': '2026-08-19T12:00:00.000Z',
        },
      }));
      await flush();

      expect(seen.single.seq, equals(6));
      expect(seen.single.senderType, equals(SenderType.agent));
      expect(seen.single.delivery, equals(MessageDelivery.confirmed));

      await harness.client.dispose();
    });

    test('emits the session snapshot from connection.ack', () async {
      final Harness harness = Harness();
      final List<SessionSnapshot> sessions = <SessionSnapshot>[];
      harness.client.sessions.listen(sessions.add);

      await harness.connected();

      expect(sessions.single.sessionId, equals('s1'));
      expect(sessions.single.status, equals(ChatStatus.open));

      await harness.client.dispose();
    });

    test('emits typing in both directions off one frame pair', () async {
      final Harness harness = Harness();
      await harness.connected();

      final List<TypingEvent> events = <TypingEvent>[];
      harness.client.typing.listen(events.add);

      for (final String type in <String>['typing.start', 'typing.stop']) {
        harness.socket.deliver(jsonEncode(<String, Object?>{
          'v': 1,
          't': type,
          'id': _serverUlid,
          'ts': 1700000000000,
          'd': <String, Object?>{'participantId': 'p1'},
        }));
      }
      await flush();

      expect(events.map((TypingEvent e) => e.isTyping),
          equals(<bool>[true, false]));
      expect(events.first.participantId, equals('p1'));

      await harness.client.dispose();
    });

    test('ignores frames it does not act on without erroring', () async {
      // message.read, message.delivered, ticket.linked, system.pong are all
      // out of scope for this pass. Decoded and dropped is not an error.
      final Harness harness = Harness();
      await harness.connected();

      harness.socket.deliver(jsonEncode(<String, Object?>{
        'v': 1,
        't': 'message.delivered',
        'id': _serverUlid,
        'ts': 1700000000000,
        'd': <String, Object?>{
          'participantId': 'p1',
          'deliveredUpToSeq': 6,
          'deliveredAt': '2026-08-19T12:00:00.000Z',
        },
      }));
      await flush();

      expect(harness.client.connectionState, equals(ConnectionState.connected));

      await harness.client.dispose();
    });
  });

  group('outbound helpers', () {
    test('typing.start and typing.stop are the only typing frames', () async {
      // §7.3 collapses v1's four names (§12.4) into one pair.
      final Harness harness = Harness();
      await harness.connected();
      final int before = harness.socket.sent.length;

      harness.client
        ..startTyping()
        ..stopTyping();

      final List<String> types = harness.socket.sent
          .skip(before)
          .map((String raw) =>
              (jsonDecode(raw) as Map<String, Object?>)['t']! as String)
          .toList();
      expect(types, equals(<String>['typing.start', 'typing.stop']));

      await harness.client.dispose();
    });

    test('markRead is one write path, over WebSocket only', () async {
      // v1 fired a WS event AND a redundant REST POST for the same fact
      // (§12.9). There is no REST call here to be out of sync with.
      final Harness harness = Harness();
      await harness.connected();
      final int before = harness.socket.sent.length;

      harness.client.markRead(upToMessageId: 'm1');

      expect(harness.socket.sent.length, equals(before + 1));
      final Map<String, Object?> sent =
          jsonDecode(harness.socket.sent.last) as Map<String, Object?>;
      expect(sent['t'], equals('message.markRead'));

      await harness.client.dispose();
    });
  });

  group('identity routing', () {
    test('agent.joined reaches agentEvents as a HandledBy', () async {
      // The frames were declared long before they were emitted; this is the
      // first release where a host actually receives one, so the routing is
      // worth an end-to-end assertion rather than only a decoder unit test.
      final Harness harness = Harness();
      await harness.connected();

      final List<AgentEvent> seen = <AgentEvent>[];
      harness.client.agentEvents.listen(seen.add);

      harness.socket.deliver(
        jsonEncode(<String, Object?>{
          'v': 1,
          't': 'agent.joined',
          'id': _serverUlid,
          'ts': 1787228815136,
          'd': <String, Object?>{
            'kind': 'AGENT',
            'id': 'agent-1',
            'displayName': 'Priya S.',
          },
        }),
      );
      await flush();

      expect(seen, hasLength(1));
      expect(seen.single.kind, equals(HandledByKind.agent));
      expect(seen.single.id, equals('agent-1'));
      expect(seen.single.displayName, equals('Priya S.'));

      await harness.client.dispose();
    });

    test('a session snapshot carries handledBy through to sessions', () async {
      final Harness harness = Harness();
      final List<SessionSnapshot> seen = <SessionSnapshot>[];
      harness.client.sessions.listen(seen.add);

      unawaited(harness.client.connect());
      await flush();
      harness.socket.deliver(
        jsonEncode(<String, Object?>{
          'v': 1,
          't': 'connection.ack',
          'id': _serverUlid,
          'ts': 1700000000000,
          'd': <String, Object?>{
            'protocolVersion': 1,
            'seq': 5,
            'session': <String, Object?>{
              'sessionId': 's1',
              'status': 'ASSIGNED',
              'mode': 'HUMAN',
              'participants': <Object?>[
                <String, Object?>{
                  'participantId': 'agent-1',
                  'type': 'AGENT',
                  'displayName': 'Priya S.',
                },
              ],
              'createdAt': '2026-08-19T10:00:00.000Z',
              'handledBy': <String, Object?>{
                'kind': 'AGENT',
                'id': 'agent-1',
                'displayName': 'Priya S.',
              },
            },
          },
        }),
      );
      await flush();

      expect(seen, hasLength(1));
      expect(seen.single.handledBy?.displayName, equals('Priya S.'));
      expect(seen.single.participants.single.displayName, equals('Priya S.'));

      await harness.client.dispose();
    });
  });
}
