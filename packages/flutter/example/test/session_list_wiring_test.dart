/// The integration this app now performs: a `RestClient` handed to
/// `ChatWidgetCubit`, and a session list that fills itself.
///
/// ── What changed here, and what that costs ───────────────────────────────
///
/// This file used to drive `sessionListFor`, the function `main.dart` called
/// to build its own refresher — so deleting the `updateSessionSummaries` call
/// inside it turned this red, which was the whole point. That function is
/// gone: `main.dart` now passes `rest: widget.rest` to the Cubit and the SDK
/// owns the fetch.
///
/// Say the cost out loud rather than let it pass as an improvement: the wire
/// is a constructor ARGUMENT now, inside `_ChatPanelState.initState`, and
/// this app has no harness that mounts that panel — it builds a real
/// `ChatClient` against a real WebSocket URL. So nothing here fails if
/// somebody deletes `rest:` from `main.dart`. The equivalent protection moved
/// into the package with the code: cutting the line in `ChatWidgetCubit` that
/// builds the source from `rest` turns three tests in
/// `test/state/rest_session_source_test.dart` red, verified by doing it.
///
/// What this file still earns is the other half — that the path `main.dart`
/// takes actually fills a list, over a real `listSessions` decode and a
/// `MockClient`. A stub row therefore carries `unreadCount`: the decoder
/// throws without it and `listSessions` drops the ROW rather than the page,
/// so a row missing it vanishes silently and looks exactly like the wiring
/// bug this whole file is about.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart'
    show ChatSessionSummary, ChatWidgetCubit, kSessionListPageSize;
import 'package:dhaam_chat_rest/dhaam_chat_rest.dart'
    show RestClient, kSessionSummaryLimitMax, kSessionSummaryLimitMin;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'attachment_wiring_test.dart' show makeFakeClient;

void main() {
  test('the path main.dart takes fills the list, with no host wiring',
      () async {
    final List<http.Request> sent = <http.Request>[];
    final RestClient rest = RestClient(
      apiUrl: 'https://chat.example.test',
      publishableKey: PublishableKey.parse('dhp_test_0123456789abcdefghijklmn'),
      getAccessToken: () async => 'tok',
      httpClient: MockClient((http.Request request) async {
        sent.add(request);
        return http.Response(
          '{"success":true,"data":{"sessions":[{"id":"s9",'
          '"status":"OPEN","mode":"BOT","createdAt":"2026-01-01T00:00:00Z",'
          '"unreadCount":0}]}}',
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      }),
    );

    // The one argument `main.dart` passes. No refresher, no mapper, no page
    // size, no `updateSessionSummaries` call — those were this app's, and the
    // reported bug was every other host not writing them.
    final ChatWidgetCubit cubit =
        ChatWidgetCubit(client: makeFakeClient(), rest: rest);
    addTearDown(cubit.close);

    // What `ChatWidget.initState` calls. `main.dart` calls nothing itself.
    await cubit.connect();
    await Future<void>.delayed(Duration.zero);

    expect(cubit.state.sessionSummaries.map((ChatSessionSummary s) => s.id),
        <String>['s9'],
        reason: 'the fetched page must reach the state MessagesScreen reads');
    expect(sent, hasLength(1), reason: 'one open, one page');
  });

  test('an empty answer is a real state, not a no-op', () async {
    // The guest case, and the one most easily mistaken for "the fetch
    // failed". `listSessions` answers a guest with `[]` by design, and the
    // screen must show its empty state rather than keep stale rows.
    final RestClient rest = RestClient(
      apiUrl: 'https://chat.example.test',
      publishableKey: PublishableKey.parse('dhp_test_0123456789abcdefghijklmn'),
      getAccessToken: () async => 'tok',
      httpClient: MockClient((http.Request _) async => http.Response(
            '{"success":true,"data":{"sessions":[]}}',
            200,
            headers: <String, String>{'content-type': 'application/json'},
          )),
    );

    final ChatWidgetCubit cubit =
        ChatWidgetCubit(client: makeFakeClient(), rest: rest);
    addTearDown(cubit.close);

    await cubit.connect();
    await Future<void>.delayed(Duration.zero);

    expect(cubit.state.sessionSummaries, isEmpty);
    expect(cubit.state.unreadCount, 0);
  });

  test('the SDK asks for a page size the adapter will accept', () {
    // An out-of-range limit throws BEFORE any request, so it would surface as
    // a caller bug at startup rather than an empty list. Not this app's
    // number any more, which is exactly why it is worth pinning from here:
    // the strip quotes it and an integrator reads it.
    expect(kSessionListPageSize,
        inInclusiveRange(kSessionSummaryLimitMin, kSessionSummaryLimitMax));
  });
}
