// The session list with NO host wiring at all: a `RestClient` handed to the
// constructor and nothing else.
//
// ── Why this file exists next to `session_source_test.dart` ──────────────
//
// That file drives the `sessionSource` seam, which is the right shape for a
// host that proxies chat through its own backend but still asks every other
// host to write the fetch, the map and the page size by hand. The reported
// bug — "conversation list not appearing", twice, from two people, both
// holding a valid signed-in token — was that nobody wrote them. So this file
// drives the other constructor path, the one where the host writes nothing.
//
// Every test here goes over a `MockClient`, the technique
// `example/test/session_list_wiring_test.dart` established: a real
// `RestClient`, a real `listSessions` decode, and no network. A stub row
// therefore carries `unreadCount` — the decoder THROWS without it and
// `listSessions` drops the row rather than the page, so a row missing it
// vanishes silently and looks exactly like a wiring failure.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:dhaam_chat_rest/dhaam_chat_rest.dart'
    show RestClient, kSessionSummaryLimitMax, kSessionSummaryLimitMin;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fake_widget_chat_client.dart';

/// Lets a queued stream event and a resolved fetch reach their listeners.
/// Same reasoning as `session_source_test.dart`'s identical helper.
Future<void> flush() => Future<void>.delayed(Duration.zero);

/// One `sessions[]` row, as the wire spells it.
///
/// `unreadCount` is not optional decoration: `decodeRestChatSessionSummary`
/// throws on a missing count and `listSessions` costs itself the ROW rather
/// than the page, so a stub without it produces an empty list and an hour of
/// looking for the wiring bug that is not there.
String _row(String id) => '{"id":"$id","status":"OPEN","mode":"BOT",'
    '"createdAt":"2026-01-01T00:00:00Z","unreadCount":0}';

String _page(List<String> ids) =>
    '{"success":true,"data":{"sessions":[${ids.map(_row).join(',')}]}}';

List<String> _ids(ChatWidgetCubit cubit) => cubit.state.sessionSummaries
    .map((ChatSessionSummary s) => s.id)
    .toList(growable: false);

void main() {
  late FakeWidgetChatClient fakeClient;

  setUp(() {
    fakeClient = FakeWidgetChatClient();
  });

  tearDown(() async {
    await fakeClient.dispose();
  });

  /// Every request this client was asked to make, in order — so a test can
  /// assert both WHAT was sent and, just as importantly, how many times.
  late List<http.Request> sent;

  /// What the route answers with RIGHT NOW. Reassigned mid-test to stand for
  /// the server's view changing, the same shape `session_source_test.dart`
  /// gives its closure.
  late List<String> page;

  /// A real `RestClient` over a `MockClient` — real `listSessions`, real
  /// decode, no network.
  RestClient restReturning(List<String> firstPage) {
    sent = <http.Request>[];
    page = firstPage;
    return RestClient(
      apiUrl: 'https://chat.example.test',
      publishableKey: PublishableKey.parse('dhp_test_0123456789abcdefghijklmn'),
      getAccessToken: () async => 'tok',
      httpClient: MockClient((http.Request request) async {
        sent.add(request);
        return http.Response(
          _page(page),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      }),
    );
  }

  group('rest', () {
    test('a RestClient alone fills the list — the host wires nothing',
        () async {
      final RestClient rest = restReturning(<String>['s9']);

      // The whole point: no `sessionSource`, no `updateSessionSummaries`
      // call, no refresher built by the host. One argument.
      final ChatWidgetCubit cubit =
          ChatWidgetCubit(client: fakeClient, rest: rest);
      addTearDown(cubit.close);

      // What `ChatWidget.initState` calls, and the only thing a host does.
      await cubit.connect();
      await flush();

      expect(_ids(cubit), <String>['s9'],
          reason: 'a valid client and a signed-in token must be enough');
      expect(sent, hasLength(1), reason: 'one open, one page');
    });

    test('asks for a page size the adapter will accept', () async {
      final RestClient rest = restReturning(<String>['s9']);
      final ChatWidgetCubit cubit =
          ChatWidgetCubit(client: fakeClient, rest: rest);
      addTearDown(cubit.close);

      await cubit.connect();
      await flush();

      // An out-of-range limit throws `RestValidationException` BEFORE any
      // request, so a bad default would reach the customer as an empty list
      // and reach the integrator as a network error it is not.
      final String? limit = sent.single.url.queryParameters['limit'];
      expect(limit, isNotNull,
          reason: 'a null limit would defer to the server default of 5, and '
              'this widget cannot page past whatever it asks for');
      expect(int.parse(limit!),
          inInclusiveRange(kSessionSummaryLimitMin, kSessionSummaryLimitMax));
    });

    test('sessionSource wins when both are supplied, and only it fetches',
        () async {
      final RestClient rest = restReturning(<String>['from-rest']);
      int closureCalls = 0;

      final ChatWidgetCubit cubit = ChatWidgetCubit(
        client: fakeClient,
        rest: rest,
        sessionSource: () async {
          closureCalls++;
          return <ChatSessionSummary>[
            ChatSessionSummary(
              id: 'from-closure',
              status: ChatStatus.open,
              mode: ChatMode.human,
              createdAt: DateTime.utc(2026, 1, 1),
            ),
          ];
        },
      );
      addTearDown(cubit.close);

      await cubit.connect();
      await flush();

      expect(_ids(cubit), <String>['from-closure'],
          reason: 'the hand-written closure is the more specific instruction');
      expect(closureCalls, 1);
      expect(sent, isEmpty,
          reason: 'two sources must not mean two fetches of the same page');
    });

    test('neither supplied leaves the list exactly as it was', () async {
      final ChatWidgetCubit cubit = ChatWidgetCubit(client: fakeClient);
      addTearDown(cubit.close);

      await cubit.connect();
      await flush();

      expect(cubit.state.sessionSummaries, isEmpty);

      // Still the host's to push, unchanged, for every caller that predates
      // both seams.
      cubit.updateSessionSummaries(<ChatSessionSummary>[
        ChatSessionSummary(
          id: 'pushed',
          status: ChatStatus.open,
          mode: ChatMode.human,
          createdAt: DateTime.utc(2026, 1, 1),
        ),
      ]);

      expect(_ids(cubit), <String>['pushed']);
    });

    test('refetches when a row the list is showing changes', () async {
      final RestClient rest = restReturning(<String>['a']);
      final ChatWidgetCubit cubit =
          ChatWidgetCubit(client: fakeClient, rest: rest);
      addTearDown(cubit.close);

      await cubit.connect();
      await flush();
      fakeClient.emitSession(testSession(id: 's1'));
      await flush();
      expect(_ids(cubit), <String>['a']);

      // The server's view moves on, and a status change is a row the list is
      // already showing changing what it says.
      page = <String>['a', 'b'];
      // The same trigger `sessionSource` gets — T2's key, not a second rule.
      fakeClient.emitSession(testSession(id: 's1', status: ChatStatus.closed));
      await flush();

      expect(_ids(cubit), <String>['a', 'b']);
    });
  });

  group('restSessionSource', () {
    test('an out-of-range limit is refused at construction, not at fetch', () {
      final RestClient rest = restReturning(<String>['s9']);

      // `listSessions` would raise `RestValidationException` inside the fetch,
      // which reaches `SessionListRefresher.onError` — the callback every
      // caller reads as "the network failed". Refused here instead, before
      // anything is wired up, so a caller bug cannot arrive wearing a network
      // error's clothes.
      expect(
        () => restSessionSource(rest: rest, limit: kSessionSummaryLimitMin - 1),
        throwsArgumentError,
      );
      expect(
        () => restSessionSource(rest: rest, limit: kSessionSummaryLimitMax + 1),
        throwsArgumentError,
      );
      expect(sent, isEmpty, reason: 'refused before any request');
    });

    test('an in-range limit builds a source that has not fetched yet', () {
      final RestClient rest = restReturning(<String>['s9']);

      restSessionSource(rest: rest, limit: kSessionSummaryLimitMin);

      // Building is not asking. The refresher decides when.
      expect(sent, isEmpty);
    });

    test('the default page size is the most the route will give', () async {
      final RestClient rest = restReturning(<String>['s9']);

      await restSessionSource(rest: rest)();

      // Not an arbitrary number: this widget cannot page, so whatever it asks
      // for is the ceiling on what a customer can ever reach.
      expect(
          sent.single.url.queryParameters['limit'], '$kSessionSummaryLimitMax');
      expect(kSessionListPageSize, kSessionSummaryLimitMax);
    });

    test('a custom limit is what actually goes on the wire', () async {
      final RestClient rest = restReturning(<String>['s9']);

      await restSessionSource(rest: rest, limit: 5)();

      expect(sent.single.url.queryParameters['limit'], '5');
    });

    test('an empty page is an empty list, never an error', () async {
      final RestClient rest = restReturning(<String>[]);

      // The guest signal. `listSessions` answers a guest with `[]` and never
      // a 403, so turning it into a throw would make "not identified"
      // indistinguishable from "the lookup failed".
      await expectLater(restSessionSource(rest: rest)(), completion(isEmpty));
    });
  });

  group('toChatSessionSummary', () {
    test('is exported, so the README snippet compiles', () {
      final ChatSessionSummary mapped = toChatSessionSummary(
        RestChatSessionSummary(
          id: 's1',
          status: ChatStatus.closed,
          mode: ChatMode.human,
          createdAt: DateTime.utc(2026, 1, 1),
          closedAt: DateTime.utc(2026, 1, 2),
          lastMessageAt: DateTime.utc(2026, 1, 3),
          lastMessagePreview: 'Where is it?',
          unreadCount: 4,
          subject: 'Order 12',
          topic: 'delivery',
          handledBy: const HandledBy(
            kind: HandledByKind.agent,
            id: 'a1',
            displayName: 'Ada',
          ),
        ),
      );

      expect(mapped.id, 's1');
      expect(mapped.status, ChatStatus.closed);
      expect(mapped.mode, ChatMode.human);
      expect(mapped.createdAt, DateTime.utc(2026, 1, 1));
      expect(mapped.closedAt, DateTime.utc(2026, 1, 2));
      expect(mapped.lastMessageAt, DateTime.utc(2026, 1, 3));
      expect(mapped.lastMessagePreview, 'Where is it?');
      expect(mapped.unreadCount, 4);
      expect(mapped.subject, 'Order 12');
      expect(mapped.topic, 'delivery');
      expect(mapped.handledBy?.displayName, 'Ada');
    });

    test('keeps an open session’s nulls as nulls', () {
      final ChatSessionSummary mapped = toChatSessionSummary(
        RestChatSessionSummary(
          id: 's2',
          status: ChatStatus.open,
          mode: ChatMode.bot,
          createdAt: DateTime.utc(2026, 1, 1),
          closedAt: null,
          lastMessageAt: null,
        ),
      );

      expect(mapped.closedAt, isNull);
      expect(mapped.lastMessageAt, isNull);
      expect(mapped.lastMessagePreview, isNull);
      expect(mapped.subject, isNull);
      expect(mapped.topic, isNull);
      expect(mapped.handledBy, isNull);
      expect(mapped.unreadCount, 0);
    });
  });
}
