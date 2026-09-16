// What a customer sees when they open a conversation they had yesterday.
//
// The reported bug's second half. `session_replacement_reset_test.dart` pins
// the first: a snapshot for a DIFFERENT session is a replacement and clears
// the transcript, so the conversation being left is no longer painted under
// the new one's id. That fix alone opens the hole these tests close —
// `createChatClient`'s `seedReplacedSession` (packages/core) names it in as
// many words: the commit clears the transcript, so "a replacement that
// nothing seeds is a permanently blank pane".
//
// The rules pinned here are that function's and `joinAndSeed`'s, ported:
//
//   * a session that REPLACES the one on screen gets page one, by explicit
//     id, issued after the commit so it writes into an already-reset
//     transcript belonging to the target;
//   * a page that comes back for a conversation the customer has since left
//     repaints nothing (`switchEpoch`/`stale()`);
//   * a page never clobbers a live message that beat it, and never
//     duplicates one (`prependPage` skips ids it already knows).
//
// Ordering has a file-local section of its own below, because `_byId` is a
// `Map` and a Dart `Map` iterates in INSERTION order.

import 'dart:async';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/remote_config_fixtures.dart';
import '../ui/csat/fake_session_actions.dart';
import 'fake_widget_chat_client.dart';

/// A hand-driven [MessageHistoryFetch]: records what it was asked for and
/// answers only when the test says so.
///
/// The gate is the whole point. A seed is a round trip, and every rule worth
/// pinning here — the stale guard, a live message racing the page — lives
/// inside the window between the ask and the answer. A fetch that resolved
/// immediately would close that window before a test could look into it.
class FakeMessageHistory {
  /// Every session id page one was asked for, oldest first. Its LENGTH is how
  /// many seeds went out, and its contents are the `joinAndSeed` rule that
  /// the ask carries an explicit id rather than reading the current session.
  final List<String> asked = <String>[];

  final List<Completer<List<ChatMessage>>> _pending =
      <Completer<List<ChatMessage>>>[];

  MessageHistoryFetch get fetch => (String sessionId) {
        asked.add(sessionId);
        final Completer<List<ChatMessage>> completer =
            Completer<List<ChatMessage>>();
        _pending.add(completer);
        return completer.future;
      };

  /// Answers the [index]th ask (default: the first one still outstanding).
  void resolve(List<ChatMessage> page, {int index = 0}) =>
      _pending[index].complete(page);

  /// Fails the [index]th ask, the way a 500 or a dropped connection would.
  void fail(Object error, {int index = 0}) =>
      _pending[index].completeError(error);
}

void main() {
  late FakeWidgetChatClient client;
  late FakeMessageHistory history;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    history = FakeMessageHistory();
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(),
      messageHistory: history.fetch,
    );
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  /// Puts the customer inside a conversation with a transcript on screen —
  /// the state a customer is in before they go back to the list and open
  /// something older.
  Future<void> openWithTranscript({
    String id = 's1',
    String messageId = 'm1',
  }) async {
    cubit.openConversation(id);
    client.emitSession(testSession(id: id));
    client.emitMessage(
      testMessage(id: messageId, content: 'the previous conversation', seq: 1),
    );
    await pumpEventQueue();
  }

  group('opening a past conversation', () {
    test('puts ITS OWN history on screen', () async {
      await openWithTranscript();

      // The customer goes back and taps a conversation from last week. The
      // snapshot for it is a replacement, so the transcript is cleared — and
      // without a seed it stays cleared, which is the blank pane.
      cubit.openConversation('s2');
      client.emitSession(testSession(id: 's2'));
      await pumpEventQueue();

      expect(history.asked, <String>['s2'],
          reason: 'page one was not asked for, or not for the session joined');

      history.resolve(<ChatMessage>[
        testMessage(id: 'h1', content: 'I never got my refund', seq: 4),
      ]);
      await pumpEventQueue();

      expect(cubit.state.session?.sessionId, 's2');
      expect(
        cubit.state.messages.map((ChatMessage m) => m.content),
        <String>['I never got my refund'],
        reason: 'the conversation the customer opened is still blank',
      );
    });
  });

  // ── Ordering ──────────────────────────────────────────────────────────
  //
  // The trap this seed sets, and the reason these tests exist as a group.
  //
  // `ChatWidgetCubit` keeps its messages in a `Map` keyed by id and renders
  // `_byId.values`. A Dart `Map` iterates in INSERTION order, so putting a
  // history page into it after a live message has landed paints yesterday's
  // messages UNDERNEATH one that arrived a second ago. Nothing about the map
  // sorts anything; the store has to be rebuilt.
  //
  // The rule is `prependPage`/`sortMessages` in packages/core, and the key is
  // `seq` — `ChatMessage.seq`'s own doc states it: "The ordering key (D2).
  // Order by this. NEVER by createdAt."
  group('a live message that beats the history page', () {
    /// Joins s2 and leaves page one in flight, which is the window a live
    /// `message.new` for the joined session can land in.
    Future<void> joinLeavingPageInFlight() async {
      await openWithTranscript();
      cubit.openConversation('s2');
      client.emitSession(testSession(id: 's2'));
      await pumpEventQueue();
    }

    test('does not end up above the history it is newer than', () async {
      await joinLeavingPageInFlight();

      // The agent answers while the transcript is still loading.
      client.emitMessage(testMessage(id: 'live', content: 'third', seq: 5));
      await pumpEventQueue();

      history.resolve(<ChatMessage>[
        testMessage(id: 'h1', content: 'first', seq: 3),
        testMessage(id: 'h2', content: 'second', seq: 4),
      ]);
      await pumpEventQueue();

      expect(
        cubit.state.messages.map((ChatMessage m) => m.content),
        <String>['first', 'second', 'third'],
        reason: 'history was appended after the live message instead of '
            'ordered by seq',
      );
    });

    test('is not clobbered by a staler copy of itself in the page', () async {
      await joinLeavingPageInFlight();

      client.emitMessage(
        testMessage(id: 'shared', content: 'as the socket has it', seq: 4),
      );
      await pumpEventQueue();

      // The page was built server-side before that frame was pushed, so the
      // same id can come back describing an older view of the message.
      // `prependPage` skips ids it already knows rather than replacing them:
      // one row, and the live one.
      history.resolve(<ChatMessage>[
        testMessage(id: 'h1', content: 'older', seq: 3),
        testMessage(id: 'shared', content: 'as the page has it', seq: 4),
      ]);
      await pumpEventQueue();

      expect(
        cubit.state.messages.map((ChatMessage m) => m.content),
        <String>['older', 'as the socket has it'],
        reason: 'the page either duplicated the live message or overwrote it',
      );
    });

    test('leaves an unsent message at the live end where it belongs',
        () async {
      await joinLeavingPageInFlight();

      // An optimistic echo: the customer typed into the conversation they
      // just opened before its history arrived. It has no `seq` because the
      // server has not acknowledged it, and §6.4/D2 put exactly those at the
      // live end — a message written locally a moment ago is the newest
      // thing in the transcript, not the oldest.
      client.emitMessage(testMessage(
        id: 'echo',
        content: 'are you there?',
        senderType: SenderType.customer,
        delivery: MessageDelivery.pending,
      ));
      await pumpEventQueue();

      history.resolve(<ChatMessage>[
        testMessage(id: 'h1', content: 'first', seq: 3),
        testMessage(id: 'h2', content: 'second', seq: 4),
      ]);
      await pumpEventQueue();

      expect(
        cubit.state.messages.map((ChatMessage m) => m.content),
        <String>['first', 'second', 'are you there?'],
        reason: 'a message with no seq did not stay at the live end',
      );
    });
  });

  // ── The stale guard ───────────────────────────────────────────────────
  //
  // `switchEpoch`/`stale()` in `createChatClient`, ported. A seed is a round
  // trip, and on a slow connection a customer can open two or three
  // conversations inside one of them. Nothing about the page that comes back
  // says which transcript is on screen by the time it arrives, so a page for
  // an abandoned conversation must be able to change nothing at all.
  group('a page for a conversation the customer has left', () {
    /// Opens s2 and then s3, leaving s2's page permanently in flight —
    /// `asked[0]` is s2's and `asked[1]` is s3's.
    Future<void> openTwoDeep() async {
      await openWithTranscript();
      cubit.openConversation('s2');
      client.emitSession(testSession(id: 's2'));
      await pumpEventQueue();
      cubit.openConversation('s3');
      client.emitSession(testSession(id: 's3'));
      await pumpEventQueue();
      expect(history.asked, <String>['s2', 's3'],
          reason: 'both joins should have asked for their own page one');
    }

    test('does not repaint the one that is', () async {
      await openTwoDeep();

      // s2's page finally lands. The customer is two conversations away.
      history.resolve(<ChatMessage>[
        testMessage(id: 'h2a', content: 'belongs to s2', seq: 7),
      ]);
      await pumpEventQueue();

      expect(cubit.state.session?.sessionId, 's3');
      expect(cubit.state.messages, isEmpty,
          reason: 's2\'s history was painted into s3');
    });

    test('does not splice itself into one that has already loaded', () async {
      await openTwoDeep();

      history.resolve(<ChatMessage>[
        testMessage(id: 'h3a', content: 'belongs to s3', seq: 2),
      ], index: 1);
      await pumpEventQueue();

      // Out of order on purpose: the abandoned page arrives last, and its
      // rows sort BELOW the ones on screen, so a missing guard would not
      // merely append — it would put another conversation's messages at the
      // top of this one.
      history.resolve(<ChatMessage>[
        testMessage(id: 'h2a', content: 'belongs to s2', seq: 1),
      ]);
      await pumpEventQueue();

      expect(
        cubit.state.messages.map((ChatMessage m) => m.content),
        <String>['belongs to s3'],
      );
    });

    test('lands on a closed widget without emitting', () async {
      await openWithTranscript();
      cubit.openConversation('s2');
      client.emitSession(testSession(id: 's2'));
      await pumpEventQueue();

      // The customer closed the panel while page one was out. An in-flight
      // fetch is not cancellable — `close`'s own note says so for the session
      // list — so the answer has to be dropped on arrival instead. Emitting
      // on a closed Cubit throws.
      await cubit.close();
      history.resolve(<ChatMessage>[testMessage(id: 'h1', seq: 2)]);
      await pumpEventQueue();
    });
  });

  // ── When a seed is not asked for, and when it fails ───────────────────
  group('what is NOT seeded', () {
    test('a refresh for the session already on screen asks for nothing',
        () async {
      await openWithTranscript();
      cubit.openConversation('s2');
      client.emitSession(testSession(id: 's2'));
      await pumpEventQueue();
      history.resolve(<ChatMessage>[testMessage(id: 'h1', seq: 2)]);
      await pumpEventQueue();
      expect(history.asked, <String>['s2']);

      // Ending a conversation, an agent picking it up, a reconnect replaying
      // the snapshot — all ordinary same-id traffic. None of it cleared
      // anything, so none of it has anything to refill, and re-reading page
      // one for each would be a request per event that repaints the same
      // rows. `commitSession`'s rule: a refresh is not a replacement.
      client.emitSession(testSession(id: 's2', status: ChatStatus.assigned));
      client.emitSession(testSession(id: 's2', status: ChatStatus.resolved));
      await pumpEventQueue();

      expect(history.asked, <String>['s2'],
          reason: 'a refresh re-read page one');
    });

    test('the FIRST session of a connection is not a replacement', () async {
      // Nothing was on screen to be replaced — `commitSession` carries the
      // same `previous !== null` guard. The ordinary path for a customer who
      // simply opens the widget and chats is unchanged by this whole feature.
      client.emitSession(testSession(id: 's1'));
      await pumpEventQueue();

      expect(history.asked, isEmpty);
    });
  });

  // ── The conversation the customer just started ────────────────────────
  //
  // The seed path nothing else in this file reaches. "New conversation"
  // mints a session, and the snapshot for it is a replacement like any
  // other, so page one is read for a conversation created moments earlier.
  // That is deliberate rather than overlooked — see `_seedTranscript` on why
  // suppressing it would cost more than the empty page it saves — but it is
  // only HARMLESS because of something stated nowhere near it: under D1 the
  // id `ChatClient` mints for an optimistic echo IS the permanent message
  // id (`client.dart`'s `_pending`: the §12.9 id-swap machinery "does not
  // exist here"). The skip in `_mergeHistoryPage` keys on that id, so an
  // optimistic-id swap would put the customer's opening line on screen
  // twice — the very first thing they ever typed, doubled.
  //
  // Pinned here so a change to D1 fails as a test rather than as a bug
  // report about a duplicated first message.
  group('a conversation the customer has just started', () {
    test('is seeded like any other replacement, and shows its opening line '
        'once', () async {
      await openWithTranscript();

      // Held open: minting is a round trip — `startNewSession` resolves on
      // the new session's `connection.ack` — and the server's snapshot for
      // the session it just minted arrives inside that window, ahead of the
      // opening line this call then sends into it.
      final Completer<void> ack = Completer<void>();
      client.newSessionGate = ack;
      final Future<void> started =
          cubit.startConversationFrom(message: 'my washing machine broke');
      await pumpEventQueue();

      client.emitSession(testSession(id: 's2'));
      await pumpEventQueue();

      expect(history.asked, <String>['s2'],
          reason: 'a freshly minted session was not seeded like any other '
              'replacement');

      // The ack lands and the opening line goes out. The fake echoes it the
      // way the real client's optimistic echo does, so it is on screen
      // before page one comes back — the whole point of this ordering.
      ack.complete();
      await started;
      await pumpEventQueue();
      expect(client.sentContent, <String>['my washing machine broke']);
      expect(cubit.state.messages, hasLength(1),
          reason: 'the opening line never reached the transcript');

      // The server's copy of that same line, as page one has it: same id,
      // because the client minted the permanent one. `prependPage`'s skip
      // fires on it, so nothing is added and nothing is repainted.
      history.resolve(<ChatMessage>[
        testMessage(
          id: 'sent-1',
          content: 'my washing machine broke',
          senderType: SenderType.customer,
          seq: 1,
        ),
      ]);
      await pumpEventQueue();

      expect(
        cubit.state.messages.map((ChatMessage m) => m.content),
        <String>['my washing machine broke'],
        reason: 'the seed for a freshly minted session duplicated the '
            'opening line the customer had already sent',
      );
    });
  });

  group('a history fetch that fails', () {
    test('reaches the host, never the customer, and empties nothing',
        () async {
      final List<Object> reported = <Object>[];
      final FlutterExceptionHandler? previous = FlutterError.onError;
      FlutterError.onError =
          (FlutterErrorDetails details) => reported.add(details.exception);
      addTearDown(() => FlutterError.onError = previous);

      await openWithTranscript();
      cubit.openConversation('s2');
      client.emitSession(testSession(id: 's2'));
      await pumpEventQueue();

      // A live message got through before the history read fell over, so
      // there is something on screen for a mishandled failure to destroy.
      client.emitMessage(testMessage(id: 'live', content: 'still here', seq: 9));
      await pumpEventQueue();

      history.fail(StateError('history route is down'));
      await pumpEventQueue();

      expect(reported, hasLength(1),
          reason: 'the host was never told the history read failed');
      expect(reported.single, isStateError);
      expect(cubit.state.lastError, isNull,
          reason: 'a history failure is not the customer\'s problem');
      expect(
        cubit.state.messages.map((ChatMessage m) => m.content),
        <String>['still here'],
        reason: 'a failed read emptied the transcript it could not fill',
      );
    });
  });

  // ── Cubits that are not the one `setUp` built ─────────────────────────
  //
  // These need a client of their OWN. `FakeWidgetChatClient`'s streams are
  // broadcast, so a second Cubit on the shared one hears every frame the
  // first does — two Cubits, two replacements, two seeds, and
  // `history.resolve()` would answer whichever asked first rather than the
  // one under test.
  group('no history source wired at all', () {
    test('opens the conversation empty, with no error and no crash', () async {
      // The constraint: an unwired host behaves EXACTLY as it did before this
      // feature existed. Off, not broken — the same way an unwired session
      // list stays empty rather than reporting a failure.
      final List<Object> reported = <Object>[];
      final FlutterExceptionHandler? previous = FlutterError.onError;
      FlutterError.onError =
          (FlutterErrorDetails details) => reported.add(details.exception);
      addTearDown(() => FlutterError.onError = previous);

      final FakeWidgetChatClient own = FakeWidgetChatClient();
      addTearDown(own.dispose);
      final ChatWidgetCubit bare = ChatWidgetCubit(
        client: own,
        initialConfig: testRemoteConfig(),
      );
      addTearDown(bare.close);

      bare.openConversation('s1');
      own.emitSession(testSession(id: 's1'));
      own.emitMessage(testMessage(id: 'm1', seq: 1));
      await pumpEventQueue();
      bare.openConversation('s2');
      own.emitSession(testSession(id: 's2'));
      await pumpEventQueue();

      expect(bare.state.session?.sessionId, 's2');
      expect(bare.state.messages, isEmpty);
      expect(reported, isEmpty);
      expect(bare.state.lastError, isNull);
    });
  });

  // ── The knock-on effect on the rating card ────────────────────────────
  //
  // `dueCsatCard` answers null for an empty transcript — "an empty thread has
  // nothing to rate", which is `csatCard`'s rule in packages/widget word for
  // word. Seeding means a conversation the customer OPENS can now be both
  // terminal and non-empty, which it could not be before, so the card becomes
  // reachable on a path it was previously unreachable on.
  //
  // That is the intended behaviour and not a regression. The guard says
  // "nothing to rate", not "do not rate a re-opened conversation": the
  // reference carries the identical emptiness guard AND seeds every
  // replacement (`commitSession` → `seedReplacedSession`), so a resolved
  // conversation opened out of a picker is offered a rating there too. Before
  // the replacement reset landed, this same card DID appear here — rating the
  // opened session while the PREVIOUS conversation's messages were on screen,
  // which is the cross-session leak that reset exists to stop. Seeding is
  // what makes the card's precondition true honestly.
  //
  // Which sessions are owed a card at all is csat_surface_test.dart's subject;
  // this pins only the part the seed changed.
  group('a resolved conversation the customer opens', () {
    /// A Cubit with a `CsatMachine` behind it, on a client and a history fake
    /// of its own — see the note above the previous group.
    (ChatWidgetCubit, FakeWidgetChatClient, FakeMessageHistory, FakeSessionActions)
        ratedCubit() {
      final FakeWidgetChatClient own = FakeWidgetChatClient();
      addTearDown(own.dispose);
      final FakeMessageHistory ownHistory = FakeMessageHistory();
      final FakeSessionActions actions = FakeSessionActions();
      final ChatWidgetCubit rated = ChatWidgetCubit(
        client: own,
        initialConfig: testRemoteConfig(),
        sessionActions: actions,
        messageHistory: ownHistory.fetch,
      );
      addTearDown(rated.close);
      return (rated, own, ownHistory, actions);
    }

    test('is owed a rating once its own transcript is on screen', () async {
      final (
        ChatWidgetCubit rated,
        FakeWidgetChatClient own,
        FakeMessageHistory ownHistory,
        FakeSessionActions actions,
      ) = ratedCubit();

      rated.openConversation('s1');
      own.emitSession(testSession(id: 's1'));
      own.emitMessage(testMessage(id: 'm1', seq: 1));
      await pumpEventQueue();

      // A conversation from last week, already resolved, opened from the
      // Messages list.
      rated.openConversation('s2');
      own.emitSession(testSession(id: 's2', status: ChatStatus.resolved));
      await pumpEventQueue();

      // Still nothing to rate: the transcript is empty for exactly as long as
      // page one is in flight, which is the pre-seed behaviour.
      expect(rated.dueCsatCard(), isNull,
          reason: 'a blank pane was offered a rating');
      expect(actions.readCsatCalls, 0,
          reason: 'the server was asked about a conversation with no content');

      ownHistory.resolve(<ChatMessage>[
        testMessage(id: 'h1', content: 'thanks, sorted', seq: 4),
      ]);
      await pumpEventQueue();

      final CsatSurface? card = rated.dueCsatCard();
      expect(card?.sessionId, 's2',
          reason: 'a resolved conversation with a transcript is rateable');
      expect(card?.alreadyRated, isFalse);
    });

    test('is still owed nothing when its history comes back empty', () async {
      final (
        ChatWidgetCubit rated,
        FakeWidgetChatClient own,
        FakeMessageHistory ownHistory,
        FakeSessionActions actions,
      ) = ratedCubit();

      rated.openConversation('s1');
      own.emitSession(testSession(id: 's1'));
      own.emitMessage(testMessage(id: 'm1', seq: 1));
      await pumpEventQueue();

      rated.openConversation('s2');
      own.emitSession(testSession(id: 's2', status: ChatStatus.resolved));
      await pumpEventQueue();
      ownHistory.resolve(<ChatMessage>[]);
      await pumpEventQueue();

      // The guard is untouched by any of this: there is genuinely nothing to
      // rate, and the lookup is never even started.
      expect(rated.dueCsatCard(), isNull);
      expect(actions.readCsatCalls, 0);
    });
  });
}
