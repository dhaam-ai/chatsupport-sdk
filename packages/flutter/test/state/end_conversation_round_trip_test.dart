// The end-conversation round trip, whole, at the Cubit's own boundary:
// `openEndConversation` → `ConfirmEndSurface` → `confirmEndConversation` →
// `ChatSessionActions.closeSession` → the server's SAME-ID `CLOSED` snapshot
// → the rating card (or the ended footer) → "New conversation" → a fresh,
// EMPTY transcript.
//
// ── CHARACTERIZATION. These pass as written, and that is the point ──────
//
// Every piece of this wiring already existed and none of it is changed by
// the tests below: the confirm surface, `closeSession`, `endedSessionId`,
// `dueCsatCard` and `startConversationFrom` are each covered in their own
// files. What had never been written down is the ROUND TRIP, and it now
// crosses three separate things:
//
//  * **The per-session transcript reset.** `_onSession` clears `_byId` only
//    on an id CHANGE. Ending a conversation pushes a snapshot for the id
//    already on screen, and `dueCsatCard` answers null when
//    `state.messages.isEmpty` — so a reset that fired here would silently
//    stop offering the survey for every conversation a customer ends, with
//    nothing failing and nothing logged.
//
//  * **Closed-session hiding.** `customerVisibleSessions` withholds CLOSED
//    rows EXCEPT the one named by `state.session`. The conversation being
//    ended is exactly that one, so its row must survive its own closure
//    rather than vanishing from under a customer still reading it.
//
//  * **Start-new from the ended footer.** The footer's second button is
//    `startNewConversation`, and what follows it must land on the NEW
//    conversation rather than repainting the one just ended.
//
// Any of those three moving breaks a flow that no single-unit test watches.
// That is what these are for; they are not evidence of a bug fixed here.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../ui/csat/fake_session_actions.dart';
import 'fake_widget_chat_client.dart';

/// Lets the CSAT lookup's microtask, and the `changes` broadcast that follows
/// it, reach their listeners — the same four turns `csat_surface_test.dart`
/// settles on, and for the same reason.
Future<void> settle() async {
  for (int i = 0; i < 4; i += 1) {
    await Future<void>.delayed(Duration.zero);
  }
}

ChatSessionSummary summaryOf(String id, ChatStatus status) =>
    ChatSessionSummary(
      id: id,
      status: status,
      mode: ChatMode.human,
      createdAt: DateTime.utc(2026, 1, 1),
      lastMessageAt: DateTime.utc(2026, 1, 2),
    );

void main() {
  late FakeWidgetChatClient client;
  late FakeSessionActions actions;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    actions = FakeSessionActions();
    cubit = ChatWidgetCubit(client: client, sessionActions: actions);
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  /// A live conversation with one message in it — what a customer is looking
  /// at when they reach for "End conversation".
  Future<void> aLiveConversation() async {
    client.emitSession(testSession(status: ChatStatus.assigned));
    client.emitMessage(testMessage(id: 'm1'));
    await settle();
  }

  /// The ⋯ menu's End row, the confirm's destructive button, and the server
  /// push that follows — the three hops the menu item actually makes.
  Future<void> endIt({String id = 's1'}) async {
    cubit.openEndConversation();
    expect(
      cubit.state.activeSurface,
      ConfirmEndSurface(sessionId: id),
      reason: 'the ⋯ menu raises the question keyed by the session it is '
          'asking about',
    );

    await cubit.confirmEndConversation(id);
    await settle();
    expect(actions.closed, <String>[id]);

    // The terminal status arrives on the SOCKET, never from the REST result
    // — `confirmEndConversation` applies nothing itself. Same id, because
    // this is the conversation being closed and not a replacement for it.
    client.emitSession(testSession(id: id, status: ChatStatus.closed));
    await settle();
  }

  test('end → the rating card → New conversation → an EMPTY transcript',
      () async {
    await aLiveConversation();
    await endIt();

    // The transcript SURVIVED the same-id snapshot. This is the assertion
    // the whole flow hangs off: `dueCsatCard` returns null for an empty
    // transcript, so a per-session reset that fired on a refresh would take
    // the survey with it and leave nothing failing.
    expect(
      cubit.state.messages.map((ChatMessage m) => m.id),
      <String>['m1'],
    );
    expect(
      cubit.state.activeSurface,
      const CsatSurface(sessionId: 's1', alreadyRated: false),
    );
    expect(cubit.endedSessionId, 's1');
    // The card is the slot's occupant, so the footer stands down — one
    // answer, not two surfaces both deciding they are on.
    expect(cubit.endedFooterDue, isFalse);

    // The customer rates it. The card locks; nothing else moves.
    await cubit.rateSession('s1', rating: 5, comment: 'sorted');
    await settle();
    expect(actions.submitted, <List<Object?>>[
      <Object?>['s1', 5, 'sorted']
    ]);
    expect(
      cubit.state.activeSurface,
      const CsatSurface(sessionId: 's1', alreadyRated: true),
    );

    // "New conversation" — the ended footer's second button, and the ONE
    // flow every other entry point funnels through.
    cubit.startNewConversation();
    expect(cubit.state.activeSurface, isA<ComposingNewSurface>());
    expect(cubit.state.screen, ScreenName.conversation);

    await cubit.startConversationFrom(message: 'a brand new question');
    await settle();

    // The conversation just ended is off screen BEFORE the ack lands — the
    // mint is a round trip, and leaving it painted for the whole flight is
    // what made "new conversation" look like it did nothing.
    expect(client.newSessionTopics, hasLength(1));
    expect(client.sentContent, <String>['a brand new question']);
    expect(
      cubit.state.messages.map((ChatMessage m) => m.id),
      isNot(contains('m1')),
    );

    // And the server answers with a DIFFERENT id, which is a replacement.
    client.emitSession(testSession(id: 's2', status: ChatStatus.open));
    await settle();

    expect(cubit.state.session?.sessionId, 's2');
    expect(cubit.state.messages, isEmpty);
    // No card and no footer: s2 is live, so there is nothing ended to rate
    // and nothing to stand in for the composer.
    expect(cubit.state.activeSurface, isNull);
    expect(cubit.endedSessionId, isNull);
    expect(cubit.endedFooterDue, isFalse);
  });

  test('the conversation being ended keeps its row until the customer leaves',
      () async {
    await aLiveConversation();
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      summaryOf('s1', ChatStatus.assigned),
      summaryOf('s0', ChatStatus.closed),
    ]);

    await endIt();

    // The host's next page reports s1 as CLOSED, which is what it now is.
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      summaryOf('s1', ChatStatus.closed),
      summaryOf('s0', ChatStatus.closed),
    ]);

    // s1 stays — it is `state.session`, and pulling a row out from under a
    // customer still reading it is worse than showing one finished row. s0
    // is somebody else's finished conversation and is withheld as usual.
    expect(
      cubit.state.customerVisibleSessions.map((ChatSessionSummary s) => s.id),
      <String>['s1'],
    );

    // Leaving it is what drops the row, on the very next rebuild.
    client.emitSession(testSession(id: 's2', status: ChatStatus.open));
    await settle();
    cubit.updateSessionSummaries(<ChatSessionSummary>[
      summaryOf('s1', ChatStatus.closed),
      summaryOf('s0', ChatStatus.closed),
      summaryOf('s2', ChatStatus.open),
    ]);

    expect(
      cubit.state.customerVisibleSessions.map((ChatSessionSummary s) => s.id),
      <String>['s2'],
    );
  });

  test('end → the ended footer when there is nothing to rate', () async {
    // No transcript: an empty conversation has nothing to rate, and the
    // survey is deliberately not offered for one.
    client.emitSession(testSession(status: ChatStatus.assigned));
    await settle();

    await endIt();

    expect(cubit.state.activeSurface, isNull);
    expect(cubit.endedSessionId, 's1');
    // Nobody is stranded on a dead composer: the footer's Reopen / New
    // conversation pair is what a terminal session with no card falls
    // through to.
    expect(cubit.endedFooterDue, isTrue);
    expect(cubit.canReopen, isTrue);
    // The lookup is never even asked — there is no transcript to rate, so
    // `dueCsatCard` answers before it reaches the machine.
    expect(actions.readCsatCalls, 0);
  });

  test('end → the footer when the CSAT lookup cannot be answered', () async {
    // The same round trip with a transcript behind it, and the survey
    // withheld for the one reason that is not "nothing to rate": showing it
    // on an unknown answer risks overwriting a score the customer already
    // gave, and only that direction loses data.
    actions.csatLookupFails = Exception('5xx');
    await aLiveConversation();

    await endIt();

    expect(cubit.state.messages, hasLength(1));
    expect(cubit.state.activeSurface, isNull);
    expect(cubit.state.csatBySession['s1'], isA<CsatUnknown>());
    expect(cubit.endedFooterDue, isTrue);
  });
}
