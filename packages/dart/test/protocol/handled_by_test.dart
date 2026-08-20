/// The v2 identity contract (T7): `HandledBy`, `SessionSnapshot.handledBy`,
/// `ParticipantSnapshot.displayName`, and `agent.joined`/`agent.left`.
///
/// One file rather than three, because the contract spans enums.dart (the
/// `kind` union), frames.dart (the shape) and json.dart (the absent-vs-null
/// rule), and the thing under test is the contract, not any one of those.
library;

import 'package:dhaam_chat/src/protocol/enums.dart';
import 'package:dhaam_chat/src/protocol/errors.dart';
import 'package:dhaam_chat/src/protocol/frames.dart';
import 'package:test/test.dart';

Map<String, Object?> sessionJson({
  Object? handledBy,
  bool withHandledBy = false,
  List<Object?>? participants,
}) =>
    <String, Object?>{
      'sessionId': 's1',
      'status': 'ASSIGNED',
      'mode': 'HUMAN',
      'participants': participants ?? <Object?>[],
      'createdAt': '2026-08-19T10:00:00.000Z',
      if (withHandledBy) 'handledBy': handledBy,
    };

Map<String, Object?> participantJson({
  Object? displayName,
  bool withDisplayName = false,
}) =>
    <String, Object?>{
      'participantId': 'p1',
      'type': 'AGENT',
      if (withDisplayName) 'displayName': displayName,
    };

void main() {
  group('HandledByKind', () {
    test('occupies the wire as a STRING, never the backend integer', () {
      // D4, and the same trap §12.1 describes for ChatStatus: the backend's
      // internal representation is an integer and it never appears on this
      // endpoint. A Dart enum's `index` is the local equivalent of that
      // integer, and nothing here reads it.
      expect(HandledByKind.agent.wire, equals('AGENT'));
      expect(HandledByKind.bot.wire, equals('BOT'));
    });

    test('parses both wire values and refuses anything else', () {
      expect(HandledByKind.fromWire('AGENT'), equals(HandledByKind.agent));
      expect(HandledByKind.fromWire('BOT'), equals(HandledByKind.bot));
      // CUSTOMER is a valid ParticipantType and is NOT a valid HandledByKind.
      expect(HandledByKind.fromWire('CUSTOMER'), isNull);
      expect(HandledByKind.fromWire('agent'), isNull);
    });
  });

  group('HandledBy', () {
    test('decodes the real agent.joined wire payload', () {
      final HandledBy handledBy = HandledBy.fromJson(
        <String, Object?>{
          'kind': 'AGENT',
          'id': 'agent-1',
          'displayName': 'Priya S.',
        },
        'd',
      );
      expect(handledBy.kind, equals(HandledByKind.agent));
      expect(handledBy.id, equals('agent-1'));
      expect(handledBy.displayName, equals('Priya S.'));
    });

    test('decodes a BOT handler', () {
      // `kind` is BOT when the bot resumes a session, e.g. after the human
      // agent leaves. "agent" in the frame name is the event-catalog name for
      // "who is handling this chat", not a claim that only humans fire it.
      final HandledBy handledBy = HandledBy.fromJson(
        <String, Object?>{'kind': 'BOT', 'id': 'bot_1', 'displayName': 'Botty'},
        'd',
      );
      expect(handledBy.kind, equals(HandledByKind.bot));
    });

    test('refuses a kind outside the AGENT|BOT union', () {
      expect(
        () => HandledBy.fromJson(
          <String, Object?>{
            'kind': 'CUSTOMER',
            'id': 'p1',
            'displayName': 'Ada',
          },
          'd.session.handledBy',
        ),
        throwsA(
          isA<FrameDecodeException>().having(
            (FrameDecodeException e) => e.path,
            'path',
            equals('d.session.handledBy.kind'),
          ),
        ),
      );
    });

    test('requires displayName — it is not optional on this shape', () {
      // Unlike the `agentName?` it replaced. A HandledBy exists precisely to
      // be rendered, so one without a name is not a degraded HandledBy, it is
      // a frame the server should not have sent.
      expect(
        () => HandledBy.fromJson(
          <String, Object?>{'kind': 'AGENT', 'id': 'agent-1'},
          'd',
        ),
        throwsA(isA<FrameDecodeException>()),
      );
    });

    test('refuses an empty or null displayName rather than passing it on', () {
      for (final Object? bad in <Object?>['', null]) {
        expect(
          () => HandledBy.fromJson(
            <String, Object?>{
              'kind': 'AGENT',
              'id': 'agent-1',
              'displayName': bad,
            },
            'd',
          ),
          throwsA(isA<FrameDecodeException>()),
          reason: 'displayName: $bad reached the decoder',
        );
      }
    });
  });

  group('SessionSnapshot.handledBy', () {
    test('is absent — not null-with-meaning — when the server omits it', () {
      // ABSENT means "render your own configured title". It does NOT mean
      // "nobody is handling this chat": `status` and `mode` already carry
      // that. A host that reads absence as unhandled will render "no agent"
      // for every queued session that simply has no resolved name yet.
      final SessionSnapshot session =
          SessionSnapshot.fromJson(sessionJson(), 'd.session');
      expect(session.handledBy, isNull);
    });

    test('decodes when present', () {
      final SessionSnapshot session = SessionSnapshot.fromJson(
        sessionJson(
          withHandledBy: true,
          handledBy: <String, Object?>{
            'kind': 'AGENT',
            'id': 'agent-1',
            'displayName': 'Priya S.',
          },
        ),
        'd.session',
      );
      expect(session.handledBy?.kind, equals(HandledByKind.agent));
      expect(session.handledBy?.displayName, equals('Priya S.'));
    });

    test('reports the failing path down to the nested field', () {
      expect(
        () => SessionSnapshot.fromJson(
          sessionJson(
            withHandledBy: true,
            handledBy: <String, Object?>{
              'kind': 'CUSTOMER',
              'id': 'p1',
              'displayName': 'Ada',
            },
          ),
          'd.session',
        ),
        throwsA(
          isA<FrameDecodeException>().having(
            (FrameDecodeException e) => e.path,
            'path',
            equals('d.session.handledBy.kind'),
          ),
        ),
      );
    });

    test('refuses an explicit null handledBy', () {
      // Absent and null are different claims on this field and the server
      // sends only the first. Accepting null would make "the key is there but
      // empty" indistinguishable from "the key was never sent", which is the
      // exact ambiguity this field's contract is written to avoid.
      expect(
        () => SessionSnapshot.fromJson(
          sessionJson(withHandledBy: true),
          'd.session',
        ),
        throwsA(isA<FrameDecodeException>()),
      );
    });
  });

  group('ParticipantSnapshot.displayName', () {
    test('is null when the server omits it — the common CUSTOMER case', () {
      final ParticipantSnapshot participant =
          ParticipantSnapshot.fromJson(participantJson(), 'd.session.p[0]');
      expect(participant.displayName, isNull);
    });

    test('decodes when present', () {
      final ParticipantSnapshot participant = ParticipantSnapshot.fromJson(
        participantJson(withDisplayName: true, displayName: 'Priya S.'),
        'd.session.p[0]',
      );
      expect(participant.displayName, equals('Priya S.'));
    });

    test('refuses null and empty rather than handing a UI a blank name', () {
      for (final Object? bad in <Object?>['', null]) {
        expect(
          () => ParticipantSnapshot.fromJson(
            participantJson(withDisplayName: true, displayName: bad),
            'd.session.participants[0]',
          ),
          throwsA(
            isA<FrameDecodeException>().having(
              (FrameDecodeException e) => e.path,
              'path',
              equals('d.session.participants[0].displayName'),
            ),
          ),
          reason: 'displayName: $bad reached the decoder',
        );
      }
    });
  });

  group('agent.joined / agent.left', () {
    test('carry a HandledBy payload verbatim', () {
      // The real wire payload, from the T7 contract.
      final HandledBy event = AgentEvent.fromJson(
        <String, Object?>{
          'kind': 'AGENT',
          'id': 'agent-1',
          'displayName': 'Priya S.',
        },
        'd',
        frameType: 'agent.joined',
      );
      expect(event.kind, equals(HandledByKind.agent));
      expect(event.id, equals('agent-1'));
      expect(event.displayName, equals('Priya S.'));
    });

    test('a BOT taking the session back is the same frame', () {
      final HandledBy event = AgentEvent.fromJson(
        <String, Object?>{'kind': 'BOT', 'id': 'bot_1', 'displayName': 'Botty'},
        'd',
        frameType: 'agent.left',
      );
      expect(event.kind, equals(HandledByKind.bot));
    });

    test('the pre-v2 {agentId, agentName} payload is refused, not coerced', () {
      // BREAKING, and deliberately unforgiving: these frames were declared but
      // never emitted before now, so there is no live traffic in the old shape
      // to be lenient towards. Coercing `agentId` into `id` would be the
      // §12.2 normalize-and-guess mistake in a new place.
      expect(
        () => AgentEvent.fromJson(
          <String, Object?>{'agentId': 'agent-1', 'agentName': 'Priya S.'},
          'd',
          frameType: 'agent.joined',
        ),
        throwsA(isA<FrameDecodeException>()),
      );
    });
  });

  group('additive evolution', () {
    test('an old server sending neither field still decodes and connects', () {
      // One-Version: every field T7 added is optional on the snapshot, so a
      // server that predates it produces a valid snapshot rather than a
      // connection that cannot complete its handshake.
      final SessionSnapshot session = SessionSnapshot.fromJson(
        sessionJson(participants: <Object?>[participantJson()]),
        'd.session',
      );
      expect(session.handledBy, isNull);
      expect(session.participants.single.displayName, isNull);
      expect(session.participants.single.type, equals(ParticipantType.agent));
    });
  });
}
