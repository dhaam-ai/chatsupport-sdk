import 'package:dhaam_chat/src/protocol/enums.dart';
import 'package:dhaam_chat/src/protocol/envelope.dart';
import 'package:dhaam_chat/src/protocol/errors.dart';
import 'package:dhaam_chat/src/protocol/frames.dart';
import 'package:test/test.dart';

const String _ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

Map<String, Object?> messageJson({int seq = 1, String id = _ulid}) =>
    <String, Object?>{
      'id': id,
      'sessionId': 's1',
      'senderId': 'u1',
      'senderType': 'CUSTOMER',
      'type': 'TEXT',
      'content': 'hello',
      'seq': seq,
      'createdAt': '2026-08-19T12:00:00.000Z',
    };

Map<String, Object?> replayFrame(int seq) => <String, Object?>{
      'v': 1,
      't': 'message.new',
      'id': _ulid,
      'ts': 1700000000000,
      'd': messageJson(seq: seq),
    };

Map<String, Object?> sessionJson() => <String, Object?>{
      'sessionId': 's1',
      'status': 'ASSIGNED',
      'mode': 'HUMAN',
      'participants': <Object?>[
        <String, Object?>{
          'participantId': 'p1',
          'type': 'AGENT',
          'lastReadAt': '2026-08-19T11:00:00.000Z',
        },
      ],
      'createdAt': '2026-08-19T10:00:00.000Z',
    };

void main() {
  group('outbound payloads', () {
    test('connection.hello carries resumeFrom as an INTEGER seq', () {
      // §8.3 calls resumeFrom "the id/seq of the last frame", which reads as
      // permission to send a ULID. D2 says it is the last applied `seq` and
      // the server validates isInteger. §8.3 is simply stale.
      final Map<String, Object?> d = connectionHelloPayload(
        token: 't',
        publishableKey: 'k',
        resumeFrom: 42,
      );
      expect(d['resumeFrom'], isA<int>());
      expect(d['resumeFrom'], equals(42));
    });

    test('connection.hello omits resumeFrom entirely on a fresh connect', () {
      // Absent means "fresh". Sending an explicit null or a 0 would be read as
      // a resume claim, and 0 specifically means "replay everything".
      final Map<String, Object?> d =
          connectionHelloPayload(token: 't', publishableKey: 'k');
      expect(d.containsKey('resumeFrom'), isFalse);
      expect(d['protocolVersion'], equals(kProtocolVersion));
    });

    test('message.send always emits type, which the server requires', () {
      // §6.3 shows type as optional (`opts?: { type?: MessageType }`). The
      // server requires it. A client that follows §6.3 literally fails every
      // plain text send.
      final Map<String, Object?> d = messageSendPayload(content: 'hi');
      expect(d['type'], equals('TEXT'));
      expect(d['content'], equals('hi'));
    });

    test('message.send puts an attachment at the top level, not in metadata',
        () {
      final Map<String, Object?> d = messageSendPayload(
        content: '',
        type: MessageType.image,
        attachment: const AttachmentMetadata(
          url: 'https://example.test/a.png',
          fileName: 'a.png',
          mimeType: 'image/png',
          size: 10,
          mediaType: 'IMAGE',
        ),
        metadata: const <String, Object?>{'caption': 'x'},
      );
      expect(d.containsKey('attachment'), isTrue);
      final Map<String, Object?> metadata =
          d['metadata']! as Map<String, Object?>;
      expect(metadata.containsKey('attachment'), isFalse);
    });

    test('typing and heartbeat payloads are empty objects, not null', () {
      // The server requires `d` to be an object for both. Sending null earns
      // VALIDATION_FAILED.
      expect(typingPayload(), isEmpty);
      expect(heartbeatPayload(), isEmpty);
    });
  });

  group('ChatMessage', () {
    test('decodes and exposes seq as the ordering key', () {
      final ChatMessage message =
          ChatMessage.fromJson(messageJson(seq: 7), 'd');
      expect(message.seq, equals(7));
      expect(message.senderType, equals(SenderType.customer));
      expect(message.createdAt.isUtc, isTrue);
    });

    test('requires seq — without it there is no ordering key', () {
      final Map<String, Object?> json = messageJson()..remove('seq');
      expect(
        () => ChatMessage.fromJson(json, 'd'),
        throwsA(isA<FrameDecodeException>()),
      );
    });

    test('rejects a createdAt with no timezone', () {
      // DateTime.parse would accept this and read it as DEVICE-LOCAL time.
      final Map<String, Object?> json = messageJson()
        ..['createdAt'] = '2026-08-19T12:00:00';
      expect(
        () => ChatMessage.fromJson(json, 'd'),
        throwsA(isA<FrameDecodeException>()),
      );
    });

    test('rejects epoch millis in createdAt', () {
      // The mirror image of putting ISO-8601 in the envelope ts.
      final Map<String, Object?> json = messageJson()
        ..['createdAt'] = 1700000000000;
      expect(
        () => ChatMessage.fromJson(json, 'd'),
        throwsA(isA<FrameDecodeException>()),
      );
    });
  });

  group('ConnectionAck', () {
    test('decodes the session snapshot, seq anchor and inline replay', () {
      final ConnectionAck ack = ConnectionAck.fromJson(<String, Object?>{
        'protocolVersion': 1,
        'session': sessionJson(),
        'seq': 12,
        'replay': <Object?>[replayFrame(11), replayFrame(12)],
      });

      expect(ack.protocolVersion, equals(1));
      expect(ack.seq, equals(12));
      expect(ack.replay, hasLength(2));
      expect(ack.session.status, equals(ChatStatus.assigned));
      expect(ack.session.participants.single.participantId, equals('p1'));
      expect(ack.session.participants.single.lastReadAt, isNotNull);
    });

    test('treats an absent replay as empty, not as an error', () {
      // Absent covers four situations: a fresh connect, an already-current
      // client, the over-cap path, and a server-side read/projection failure.
      // Only `seq` separates them.
      final ConnectionAck ack = ConnectionAck.fromJson(<String, Object?>{
        'protocolVersion': 1,
        'session': sessionJson(),
        'seq': 40,
      });
      expect(ack.replay, isEmpty);
      expect(ack.seq, equals(40));
    });

    test('validates every replayed frame with the normal decoder', () {
      // A replayed frame is not more trustworthy for being nested inside an
      // ack. §14 applies to it identically.
      expect(
        () => ConnectionAck.fromJson(<String, Object?>{
          'protocolVersion': 1,
          'session': sessionJson(),
          'seq': 12,
          'replay': <Object?>[
            <String, Object?>{
              'v': 1,
              't': 'message.new',
              'id': 'not-a-ulid',
              'ts': 1700000000000,
              'd': messageJson(),
            },
          ],
        }),
        throwsA(isA<FrameDecodeException>()),
      );
    });

    test('requires the seq anchor', () {
      expect(
        () => ConnectionAck.fromJson(<String, Object?>{
          'protocolVersion': 1,
          'session': sessionJson(),
        }),
        throwsA(isA<FrameDecodeException>()),
      );
    });

    test('rejects a session status v1 could not model', () {
      final Map<String, Object?> session = sessionJson()
        ..['status'] = 'ESCALATED';
      expect(
        () => ConnectionAck.fromJson(<String, Object?>{
          'protocolVersion': 1,
          'session': session,
          'seq': 1,
        }),
        throwsA(isA<FrameDecodeException>()),
      );
    });

    test('accepts the two statuses v1 dropped on the floor', () {
      for (final String status in <String>['RESOLVED', 'ON_HOLD']) {
        final Map<String, Object?> session = sessionJson()..['status'] = status;
        final ConnectionAck ack = ConnectionAck.fromJson(<String, Object?>{
          'protocolVersion': 1,
          'session': session,
          'seq': 1,
        });
        expect(ack.session.status.wire, equals(status));
      }
    });
  });

  group('other server payloads', () {
    test('session.closed distinguishes SWITCHED from MANUAL', () {
      final SessionClosed closed = SessionClosed.fromJson(<String, Object?>{
        'sessionId': 's1',
        'closeReason': 'SWITCHED',
      });
      expect(closed.closeReason, equals(CloseReason.switched));
    });

    test('message.read carries an ISO-8601 watermark', () {
      final MessageRead read = MessageRead.fromJson(<String, Object?>{
        'participantId': 'p1',
        'readAt': '2026-08-19T12:00:00Z',
      });
      expect(read.readAt.isUtc, isTrue);
    });

    test('presence.update leaves lastSeen absent while online', () {
      final PresenceEntry entry = PresenceEntry.fromJson(
        <String, Object?>{'participantId': 'p1', 'status': 'ONLINE'},
        'd',
      );
      expect(entry.status, equals(PresenceStatus.online));
      expect(entry.lastSeen, isNull);
    });

    test('agent.joined tolerates a missing agentName', () {
      final AgentEvent event = AgentEvent.fromJson(
        <String, Object?>{'agentId': 'a1'},
        'agent.joined',
      );
      expect(event.agentId, equals('a1'));
      expect(event.agentName, isNull);
    });
  });
}
