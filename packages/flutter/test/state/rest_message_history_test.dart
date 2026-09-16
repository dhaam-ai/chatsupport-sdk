// The transcript seed with NO host wiring at all: a `RestClient` handed to
// the constructor and nothing else.
//
// ── Why this file exists next to `session_history_seed_test.dart` ─────────
//
// That file drives the `messageHistory` seam with a closure, which is the
// right shape for a host that proxies chat through its own backend — and
// which asks every OTHER host to write the fetch, the page size and the page
// ORDER by hand. The session list learned that lesson the expensive way
// ("conversation list not appearing", twice, from two people holding valid
// tokens, because nobody wrote the six lines), so this file drives the other
// constructor path: the one where the host writes nothing.
//
// Every test here goes over a `MockClient` — a real `RestClient`, a real
// `listMessages` decode and no network — the technique
// `rest_session_source_test.dart` uses for the same job one seam over.

import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:dhaam_chat_rest/dhaam_chat_rest.dart' show RestClient;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fake_widget_chat_client.dart';

/// Lets a queued stream event and a resolved fetch reach their listeners.
/// Same reasoning as `rest_session_source_test.dart`'s identical helper.
Future<void> flush() => Future<void>.delayed(Duration.zero);

/// One raw history row, exactly as the REST route sends it — integer enums,
/// `chatSessionId`, no projection. Copied in shape from
/// `packages/dart_rest/test/media_history_test.dart`, because a row this
/// package's decoder refuses costs the ROW and not the page, and a stub that
/// got a field wrong would vanish silently and look exactly like a wiring bug.
Map<String, Object?> _row(String id, int seq) => <String, Object?>{
      'id': id,
      'chatSessionId': 's2',
      'senderId': 'agent-9',
      'senderType': 2,
      'messageType': 4,
      'content': id,
      'metadata': null,
      'replyToMessageId': null,
      'seq': seq,
      'createdAt': '2026-08-19T10:00:00.000Z',
    };

void main() {
  late FakeWidgetChatClient fakeClient;
  late List<http.Request> sent;

  /// The rows the route answers with RIGHT NOW, newest first — which is the
  /// order `listMessages` documents and therefore the order the seed has to
  /// cope with.
  late List<Map<String, Object?>> newestFirst;

  setUp(() {
    fakeClient = FakeWidgetChatClient();
    sent = <http.Request>[];
    newestFirst = <Map<String, Object?>>[];
  });

  tearDown(() async {
    await fakeClient.dispose();
  });

  /// A real `RestClient` over a `MockClient` — real `listMessages`, real
  /// decode, no network.
  RestClient restClient() => RestClient(
        apiUrl: 'https://chat.example.test',
        publishableKey:
            PublishableKey.parse('dhp_test_0123456789abcdefghijklmn'),
        getAccessToken: () async => 'tok',
        httpClient: MockClient((http.Request request) async {
          sent.add(request);
          return http.Response(
            jsonEncode(<String, Object?>{
              'success': true,
              'data': <String, Object?>{
                'messages': newestFirst,
                'hasMore': false,
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }),
      );

  /// Opens s1, then replaces it with s2 — the path a customer takes when they
  /// go back to the list and tap a conversation from last week.
  Future<void> openPastConversation(ChatWidgetCubit cubit) async {
    cubit.openConversation('s1');
    fakeClient.emitSession(testSession(id: 's1'));
    await flush();
    cubit.openConversation('s2');
    fakeClient.emitSession(testSession(id: 's2'));
    await flush();
    await flush();
  }

  List<String> contents(ChatWidgetCubit cubit) => cubit.state.messages
      .map((ChatMessage m) => m.content)
      .toList(growable: false);

  /// Just the history reads. `rest:` fills the session LIST from the same
  /// client, and those requests land in [sent] too — counting them as history
  /// reads would make "only the closure fetched" unassertable.
  List<http.Request> historyCalls() => sent
      .where((http.Request r) => r.url.path.endsWith('/messages'))
      .toList(growable: false);

  group('rest', () {
    test('a RestClient alone fills the transcript — the host wires nothing',
        () async {
      newestFirst = <Map<String, Object?>>[_row('m2', 8), _row('m1', 7)];

      // The whole point: no `messageHistory`, no closure, no seeding code in
      // the host at all. One argument, the same one that fills the list.
      final ChatWidgetCubit cubit =
          ChatWidgetCubit(client: fakeClient, rest: restClient());
      addTearDown(cubit.close);

      await openPastConversation(cubit);

      expect(contents(cubit), <String>['m1', 'm2'],
          reason: 'a valid client and a signed-in token must be enough');
    });

    test('turns the route\'s newest-first page the right way up', () async {
      // The single most consequential thing this adapter does. The route
      // documents "newest first, paging backwards"; a page handed straight
      // through paints the conversation upside down for any row that carries
      // no `seq` to be reordered by.
      newestFirst = <Map<String, Object?>>[
        <String, Object?>{..._row('newest', 9), 'seq': null},
        <String, Object?>{..._row('middle', 8), 'seq': null},
        <String, Object?>{..._row('oldest', 7), 'seq': null},
      ];

      final ChatWidgetCubit cubit =
          ChatWidgetCubit(client: fakeClient, rest: restClient());
      addTearDown(cubit.close);

      await openPastConversation(cubit);

      expect(contents(cubit), <String>['oldest', 'middle', 'newest']);
    });

    test('asks the newest page for, by id, with no cursor', () async {
      newestFirst = <Map<String, Object?>>[_row('m1', 7)];

      final ChatWidgetCubit cubit =
          ChatWidgetCubit(client: fakeClient, rest: restClient());
      addTearDown(cubit.close);

      await openPastConversation(cubit);

      expect(historyCalls(), hasLength(1), reason: 'one join, one page');
      final Uri url = historyCalls().single.url;
      expect(url.path, endsWith('/chat/sessions/s2/messages'),
          reason: 'page one must be read for the session actually joined');
      expect(url.queryParameters.containsKey('before'), isFalse,
          reason: 'a cursor spelled "" or "null" asks for a page that does '
              'not exist, and arrives as an empty transcript');
      expect(url.queryParameters['limit'], '$kMessageHistoryPageSize');
    });

    test('messageHistory wins when both are supplied, and only it fetches',
        () async {
      newestFirst = <Map<String, Object?>>[_row('from-rest', 7)];
      int closureCalls = 0;

      final ChatWidgetCubit cubit = ChatWidgetCubit(
        client: fakeClient,
        rest: restClient(),
        messageHistory: (String sessionId) async {
          closureCalls++;
          return <ChatMessage>[
            testMessage(id: 'c1', content: 'from-closure', seq: 7),
          ];
        },
      );
      addTearDown(cubit.close);

      await openPastConversation(cubit);

      expect(contents(cubit), <String>['from-closure'],
          reason: 'the hand-written closure is the more specific instruction');
      expect(closureCalls, 1);
      expect(historyCalls(), isEmpty,
          reason: 'two sources must not mean two reads of the same page');
    });
  });

  group('restMessageHistory', () {
    test('a non-positive limit is refused at construction, not at fetch', () {
      final RestClient rest = restClient();

      // The route answers a bad limit with a 400, which would reach the
      // Cubit's error channel wearing a network failure's clothes. Refused
      // here instead, before anything is wired up.
      expect(() => restMessageHistory(rest: rest, limit: 0),
          throwsArgumentError);
      expect(() => restMessageHistory(rest: rest, limit: -1),
          throwsArgumentError);
      expect(sent, isEmpty, reason: 'refused before any request');
    });

    test('building is not asking', () {
      restMessageHistory(rest: restClient());

      expect(sent, isEmpty);
    });

    test('a custom limit is what actually goes on the wire', () async {
      newestFirst = <Map<String, Object?>>[_row('m1', 7)];

      await restMessageHistory(rest: restClient(), limit: 100)('s7');

      expect(sent.single.url.queryParameters['limit'], '100');
      expect(sent.single.url.path, endsWith('/chat/sessions/s7/messages'));
    });

    test('an empty page is an empty list, never an error', () async {
      final List<ChatMessage> page =
          await restMessageHistory(rest: restClient())('s7');

      // A conversation with nothing in it is a real thing, and so is one
      // whose first message has not been sent yet. Turning that into an error
      // would make "no messages" indistinguishable from "the read failed" at
      // the one seam that knows they are different.
      expect(page, isEmpty);
    });
  });
}
