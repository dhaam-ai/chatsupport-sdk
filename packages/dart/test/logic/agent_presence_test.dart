/// Reproduces `packages/core/test/client/session.test.ts`'s `applyAgentJoined`
/// / `applyAgentLeft` blocks, plus the end-to-end fold that
/// `identity-header-mount.test.ts` exercises through the widget.
///
/// The end-to-end half lives here rather than in `client_test.dart` so the
/// shared harness in that file is not touched — see this run's hot-file rule.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:test/test.dart';

import '../fakes.dart';

final PublishableKey _testKey = PublishableKey.parse('dhp_${'test'}_abc123XYZ');

const String _serverUlid = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

/// A `connection.ack` whose session carries [handledBy] and [status].
///
/// `status` defaults to OPEN for the same reason
/// `identity-header-mount.test.ts` opens its own session that way: neither
/// fold touches `status`, and `isHandledByCurrent` refuses to name a handler
/// while the session still says WAITING_FOR_AGENT. A test that used the
/// waiting status would be asserting the gate, not the fold.
String _ackJson({
  String sessionId = 's1',
  String status = 'OPEN',
  Map<String, Object?>? handledBy,
}) =>
    jsonEncode(<String, Object?>{
      'v': 1,
      't': 'connection.ack',
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'protocolVersion': 1,
        'seq': 5,
        'session': <String, Object?>{
          'sessionId': sessionId,
          'status': status,
          'mode': 'BOT',
          'participants': <Object?>[],
          'createdAt': '2026-08-19T10:00:00.000Z',
          if (handledBy != null) 'handledBy': handledBy,
        },
      },
    });

String _agentFrame(
  String type, {
  String kind = 'AGENT',
  String id = 'agt_1',
  String displayName = 'Ada',
}) =>
    jsonEncode(<String, Object?>{
      'v': 1,
      't': type,
      'id': _serverUlid,
      'ts': 1700000000000,
      'd': <String, Object?>{
        'kind': kind,
        'id': id,
        'displayName': displayName,
      },
    });

class _Harness {
  _Harness() {
    client = ChatClient(
      wsUrl: Uri.parse('wss://example.test/v2'),
      publishableKey: _testKey,
      getToken: () async => 'jwt',
      scheduler: FakeScheduler(),
      socketFactory: (Uri _) async {
        final FakeSocket socket = FakeSocket();
        sockets.add(socket);
        return socket;
      },
    );
    sessions = <SessionSnapshot>[];
    agentEvents = <AgentEvent>[];
    client.sessions.listen(sessions.add);
    client.agentEvents.listen(agentEvents.add);
  }

  late final ChatClient client;
  late final List<SessionSnapshot> sessions;
  late final List<AgentEvent> agentEvents;
  final List<FakeSocket> sockets = <FakeSocket>[];

  FakeSocket get socket => sockets.last;

  Future<void> connected({
    String status = 'OPEN',
    Map<String, Object?>? handledBy,
  }) async {
    unawaited(client.connect());
    await flush();
    socket.deliver(_ackJson(status: status, handledBy: handledBy));
    await flush();
  }
}

SessionSnapshot _session({HandledBy? handledBy, ChatStatus? status}) =>
    SessionSnapshot(
      sessionId: 's1',
      status: status ?? ChatStatus.open,
      mode: ChatMode.bot,
      participants: const <ParticipantSnapshot>[],
      createdAt: DateTime.utc(2026, 8, 19),
      handledBy: handledBy,
    );

const HandledBy _ada =
    HandledBy(kind: HandledByKind.agent, id: 'agt_1', displayName: 'Ada');
const HandledBy _bob =
    HandledBy(kind: HandledByKind.agent, id: 'agt_2', displayName: 'Bob');

void main() {
  group('applyAgentJoined', () {
    test('records the joiner as the handler', () {
      final SessionSnapshot? result = applyAgentJoined(_session(), _ada);

      expect(result?.handledBy?.displayName, equals('Ada'));
      expect(result?.handledBy?.id, equals('agt_1'));
    });

    test('replaces an existing handler on a hand-off', () {
      final SessionSnapshot? result =
          applyAgentJoined(_session(handledBy: _ada), _bob);

      expect(result?.handledBy?.displayName, equals('Bob'));
    });

    test('records a BOT the same way it records a human', () {
      const HandledBy bot = HandledBy(
        kind: HandledByKind.bot,
        id: 'bot_1',
        displayName: 'Acme Assistant',
      );

      final SessionSnapshot? result = applyAgentJoined(_session(), bot);

      expect(result?.handledBy?.kind, equals(HandledByKind.bot));
      expect(result?.handledBy?.displayName, equals('Acme Assistant'));
    });

    test('leaves status alone', () {
      // The property `identity-header-mount.test.ts` pins from the other
      // side: a join does not decide whether the session is still waiting.
      final SessionSnapshot? result = applyAgentJoined(
        _session(status: ChatStatus.waitingForAgent),
        _ada,
      );

      expect(result?.status, equals(ChatStatus.waitingForAgent));
    });

    test('a null session stays null', () {
      expect(applyAgentJoined(null, _ada), isNull);
    });
  });

  group('applyAgentLeft', () {
    test('clears the handler it names', () {
      final SessionSnapshot? result =
          applyAgentLeft(_session(handledBy: _ada), 'agt_1');

      expect(result?.handledBy, isNull);
    });

    test('leaves a DIFFERENT handler in place', () {
      // The agent who handed off and then dropped off. Clearing here would
      // blank the name of somebody still sitting on the chat.
      final SessionSnapshot before = _session(handledBy: _bob);

      final SessionSnapshot? result = applyAgentLeft(before, 'agt_1');

      expect(result?.handledBy?.displayName, equals('Bob'));
      expect(identical(result, before), isTrue);
    });

    test('is a no-op when nobody is handling the session', () {
      final SessionSnapshot before = _session();

      expect(identical(applyAgentLeft(before, 'agt_1'), before), isTrue);
    });

    test('leaves status alone', () {
      final SessionSnapshot? result = applyAgentLeft(
        _session(handledBy: _ada, status: ChatStatus.open),
        'agt_1',
      );

      expect(result?.status, equals(ChatStatus.open));
    });

    test('a null session stays null', () {
      expect(applyAgentLeft(null, 'agt_1'), isNull);
    });
  });

  group('SessionSnapshot.copyWith', () {
    test('carries every other field through untouched', () {
      final SessionSnapshot before = SessionSnapshot(
        sessionId: 's9',
        status: ChatStatus.open,
        mode: ChatMode.human,
        participants: const <ParticipantSnapshot>[],
        createdAt: DateTime.utc(2026, 1, 2),
        ticketId: 'tkt_1',
      );

      final SessionSnapshot after = before.copyWith(handledBy: _ada);

      expect(after.sessionId, equals('s9'));
      expect(after.status, equals(ChatStatus.open));
      expect(after.mode, equals(ChatMode.human));
      expect(after.createdAt, equals(DateTime.utc(2026, 1, 2)));
      expect(after.ticketId, equals('tkt_1'));
      expect(after.handledBy?.displayName, equals('Ada'));
    });

    test('clearHandledBy wins over a supplied handler', () {
      final SessionSnapshot after = _session(handledBy: _ada)
          .copyWith(handledBy: _bob, clearHandledBy: true);

      expect(after.handledBy, isNull);
    });
  });

  group('the client folds agent presence onto the session stream', () {
    test('an agent joining mid-conversation reaches sessions', () async {
      // The end-to-end counterpart of `identity-header-mount.test.ts`'s
      // "updates when an agent joins mid-conversation".
      final _Harness harness = _Harness();
      await harness.connected();
      expect(harness.sessions.single.handledBy, isNull);

      harness.socket.deliver(_agentFrame('agent.joined'));
      await flush();

      expect(harness.sessions.length, equals(2));
      expect(harness.sessions.last.handledBy?.displayName, equals('Ada'));
    });

    test('an agent LEAVING clears the handler rather than restating it',
        () async {
      // The case that makes this fold worth doing at the decode site: both
      // frames carry the identical payload, so a consumer of `agentEvents`
      // alone would read this departure as an arrival and put Ada's name
      // back on the header at the moment she walked away.
      final _Harness harness = _Harness();
      await harness.connected(
        handledBy: <String, Object?>{
          'kind': 'AGENT',
          'id': 'agt_1',
          'displayName': 'Ada',
        },
      );
      expect(harness.sessions.single.handledBy?.displayName, equals('Ada'));

      harness.socket.deliver(_agentFrame('agent.left'));
      await flush();

      expect(harness.sessions.last.handledBy, isNull);
    });

    test('a departure naming somebody else emits no session at all', () async {
      final _Harness harness = _Harness();
      await harness.connected(
        handledBy: <String, Object?>{
          'kind': 'AGENT',
          'id': 'agt_2',
          'displayName': 'Bob',
        },
      );

      harness.socket.deliver(_agentFrame('agent.left'));
      await flush();

      // One session (the ack) and no repaint — but the EVENT still went out,
      // because a toast about who left is still true.
      expect(harness.sessions.length, equals(1));
      expect(harness.sessions.single.handledBy?.displayName, equals('Bob'));
      expect(harness.agentEvents.single.id, equals('agt_1'));
    });

    test('agentEvents still carries both frames, unchanged', () async {
      final _Harness harness = _Harness();
      await harness.connected();

      harness.socket.deliver(_agentFrame('agent.joined'));
      harness.socket.deliver(_agentFrame('agent.left'));
      await flush();

      expect(harness.agentEvents.length, equals(2));
      expect(
        harness.agentEvents.map((AgentEvent e) => e.displayName),
        equals(<String>['Ada', 'Ada']),
      );
    });

    test('the session moves BEFORE the event is announced', () async {
      // `create-chat-client.ts` sets state then emits, so a listener that
      // reacts to the event by reading state finds the state already moved.
      final _Harness harness = _Harness();
      await harness.connected();

      final List<String> order = <String>[];
      harness.client.sessions
          .listen((SessionSnapshot _) => order.add('session'));
      harness.client.agentEvents.listen((AgentEvent _) => order.add('event'));

      harness.socket.deliver(_agentFrame('agent.joined'));
      await flush();

      expect(order, equals(<String>['session', 'event']));
    });

    test('an agent frame before any session is dropped, not fabricated',
        () async {
      final _Harness harness = _Harness();
      unawaited(harness.client.connect());
      await flush();

      harness.socket.deliver(_agentFrame('agent.joined'));
      await flush();

      expect(harness.sessions, isEmpty);
      // The event is still announced — it happened, whatever this client
      // knows about the session it happened on.
      expect(harness.agentEvents.single.displayName, equals('Ada'));
    });

    test('a malformed agent frame is never partially applied', () async {
      // §14's rule, at this fold specifically: the decode runs to completion
      // before anything is written, so a refused frame leaves the session
      // exactly as it was rather than half-clearing the handler.
      //
      // The refusal itself escapes the listener — that is `ChatClient`'s
      // pre-existing behaviour for EVERY push payload (`_onPush` decodes
      // unguarded), not something this fold introduced — so it is caught
      // here rather than asserted away.
      late final _Harness harness;
      final List<Object> errors = <Object>[];

      await runZonedGuarded(() async {
        harness = _Harness();
        await harness.connected(
          handledBy: <String, Object?>{
            'kind': 'AGENT',
            'id': 'agt_1',
            'displayName': 'Ada',
          },
        );

        // `displayName` is required — HandledBy.fromJson refuses it.
        harness.socket.deliver(
          jsonEncode(<String, Object?>{
            'v': 1,
            't': 'agent.left',
            'id': _serverUlid,
            'ts': 1700000000000,
            'd': <String, Object?>{'kind': 'AGENT', 'id': 'agt_1'},
          }),
        );
        await flush();
      }, (Object error, StackTrace _) => errors.add(error));

      expect(errors.single, isA<FrameDecodeException>());
      // Nothing moved: still one session, still handled by Ada, no event.
      expect(harness.sessions.length, equals(1));
      expect(harness.sessions.single.handledBy?.displayName, equals('Ada'));
      expect(harness.agentEvents, isEmpty);
    });
  });
}
