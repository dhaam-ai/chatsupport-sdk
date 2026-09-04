// WHICH session is owed a rating card, which gets the ended footer, and which
// gets neither — the Cubit-level counterpart of:
//
//   * csat-submit.test.ts:344-597 — already-rated, the reload case, a lookup
//     that cannot be answered, a deployment with no read route, and a rating
//     that arrived from somewhere else while the card was open
//   * product-surfaces.test.ts:304-338 — a session parked by a SWITCHED close
//   * ended-conversation.test.ts / session-closed.test.ts — the footer's own
//     precedence, and "Reopen" reaching the real route
//
// What the card, the footer and the confirm DO once on screen is covered in
// their own three files — the same split the reference makes between
// `end-conversation.test.ts` and `ended-conversation.test.ts`.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';
import 'fake_session_actions.dart';

/// Lets the lookup's own microtask, and the `changes` broadcast that follows
/// it, reach their listeners. Two turns, not one: the verdict lands on the
/// first and the re-sync it triggers on the second.
Future<void> settle() async {
  for (int i = 0; i < 4; i += 1) {
    await Future<void>.delayed(Duration.zero);
  }
}

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

  /// A session with one message in it, ended the ordinary way.
  Future<void> endedWithATranscript({
    String id = 's1',
    ChatStatus status = ChatStatus.resolved,
  }) async {
    client.emitSession(testSession(id: id, status: ChatStatus.assigned));
    client.emitMessage(testMessage(id: 'm1'));
    await settle();
    client.emitSession(testSession(id: id, status: status));
    await settle();
  }

  CsatSurface? card() => cubit.state.activeSurface as CsatSurface?;

  group('a session parked by a SWITCHED close', () {
    test('gets no survey and no footer once its status reads terminal',
        () async {
      client.emitSession(testSession(status: ChatStatus.assigned));
      client.emitMessage(testMessage(id: 'm1'));
      await settle();
      expect(cubit.state.activeSurface, isNull);

      // This tab watches its own session get parked — another of the
      // customer's tabs started a new conversation. The status still moves to
      // CLOSED on the server, so ONLY the close reason stands between this
      // session and a survey for a conversation nobody ended.
      client.emitSessionClosed('s1', CloseReason.switched);
      client.emitSession(testSession(status: ChatStatus.closed));
      await settle();

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.endedFooterDue, isFalse);
      expect(actions.readCsatCalls, 0);

      // A later snapshot saying the same thing changes nothing.
      client.emitSession(testSession(status: ChatStatus.resolved));
      await settle();

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.endedFooterDue, isFalse);
    });

    test('does not leak onto a DIFFERENT session\'s genuine resolution',
        () async {
      client.emitSession(testSession(status: ChatStatus.assigned));
      client.emitMessage(testMessage(id: 'm1'));
      client.emitSessionClosed('s1', CloseReason.switched);
      await settle();

      // The customer moves to another conversation, and THAT one resolves
      // properly. The park is compared by exact id, so it releases here.
      client.emitSession(testSession(id: 's2', status: ChatStatus.assigned));
      await settle();
      client.emitSession(testSession(id: 's2', status: ChatStatus.resolved));
      await settle();

      expect(card()?.sessionId, 's2');
    });

    test('a MANUAL or RESOLVED close parks nothing', () async {
      client.emitSession(testSession(status: ChatStatus.assigned));
      client.emitMessage(testMessage(id: 'm1'));
      client.emitSessionClosed('s1', CloseReason.manual);
      client.emitSession(testSession(status: ChatStatus.closed));
      await settle();

      expect(card()?.sessionId, 's1');
    });
  });

  group('a conversation the customer already rated', () {
    test('is offered the card LOCKED, and never a second write', () async {
      actions.csatOnFile = const CsatRated(rating: 4, comment: 'Great');
      await endedWithATranscript();

      expect(card(), const CsatSurface(sessionId: 's1', alreadyRated: true));
      expect(
        cubit.state.csatBySession['s1'],
        const CsatRated(rating: 4, comment: 'Great'),
      );
      expect(actions.submitted, isEmpty);
    });

    test('is offered the survey when the server says nobody has rated it',
        () async {
      await endedWithATranscript();
      expect(card(), const CsatSurface(sessionId: 's1', alreadyRated: false));
    });

    // The reload case. A client-only flag dies here; the server's answer does
    // not.
    test('stays locked for a FRESH cubit over the same session', () async {
      await endedWithATranscript();
      await cubit.rateSession('s1', rating: 3);
      await settle();
      expect(actions.submitted, hasLength(1));

      // Throw the widget away and build another one over the same session,
      // which is what a reload is.
      await cubit.close();
      actions.csatOnFile = const CsatRated(rating: 3);
      cubit = ChatWidgetCubit(client: client, sessionActions: actions);
      await endedWithATranscript();

      expect(card(), const CsatSurface(sessionId: 's1', alreadyRated: true));
      // The second instance offered no way to rate again, so nothing more was
      // sent.
      expect(actions.submitted, hasLength(1));
    });

    test('an empty transcript is owed no card at all — and gets the footer',
        () async {
      client.emitSession(testSession(status: ChatStatus.resolved));
      await settle();

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.endedFooterDue, isTrue);
      expect(actions.readCsatCalls, 0);
    });
  });

  group('when the CSAT lookup cannot be answered', () {
    // The two ways to be wrong are not symmetric: showing the survey on an
    // unknown answer risks a customer overwriting a score they already gave,
    // while hiding it risks not collecting one. Only the first loses data.
    test('withholds the survey and leaves the ended footer', () async {
      actions.csatLookupFails = Exception('5xx');
      await endedWithATranscript();

      expect(cubit.state.activeSurface, isNull);
      expect(cubit.state.csatBySession['s1'], isA<CsatUnknown>());
      // Nobody is stranded: the footer's Reopen / New conversation pair is
      // what a terminal session with no card falls through to.
      expect(cubit.endedFooterDue, isTrue);
    });

    test('remembers the failure rather than retrying on every repaint',
        () async {
      actions.csatLookupFails = Exception('5xx');
      await endedWithATranscript();
      expect(actions.readCsatCalls, 1);

      client.emitSession(testSession(status: ChatStatus.closed));
      await settle();
      expect(actions.readCsatCalls, 1);
    });
  });

  // A client is embedded in apps that outlive any one backend release. Gating
  // the survey on a brand-new route with no fallback would mean a staged
  // rollout or a rollback silently stops collecting ratings altogether.
  group('a deployment with no GET /csat route', () {
    test('still offers the survey, and still records the rating', () async {
      actions.csatLookupFails = const CsatRouteMissing();
      await endedWithATranscript();

      expect(card(), const CsatSurface(sessionId: 's1', alreadyRated: false));

      await cubit.rateSession('s1', rating: 5);
      await settle();

      expect(actions.submitted, <List<Object?>>[
        <Object?>['s1', 5, null]
      ]);
      expect(card(), const CsatSurface(sessionId: 's1', alreadyRated: true));
    });

    test('asks the missing route ONCE, not on every repaint', () async {
      actions.csatLookupFails = const CsatRouteMissing();
      await endedWithATranscript();
      expect(actions.readCsatCalls, 1);

      // Any state change re-runs the sync; the verdict is cached.
      client.emitSession(testSession(status: ChatStatus.closed));
      await settle();
      client.emitMessage(testMessage(id: 'm2'));
      await settle();
      expect(actions.readCsatCalls, 1);
    });
  });

  // Nothing on the wire invalidates a cached `unrated` — there is no CSAT
  // frame and no event — and the POST is an upsert.
  group('a rating that arrived from somewhere else while the card was open',
      () {
    test('is not overwritten, and the card shows the rating that STANDS',
        () async {
      await endedWithATranscript();
      expect(card()?.alreadyRated, isFalse);

      // The other tab rates it 5. Nothing tells this widget.
      actions.csatOnFile = const CsatRated(rating: 5, comment: 'Perfect');

      await cubit.rateSession('s1', rating: 2);
      await settle();

      expect(actions.submitted, isEmpty);
      expect(card(), const CsatSurface(sessionId: 's1', alreadyRated: true));
      expect(
        cubit.state.csatBySession['s1'],
        const CsatRated(rating: 5, comment: 'Perfect'),
      );
    });

    test('lets the rating through when the RE-CHECK itself fails', () async {
      // The opposite asymmetry from an unknown lookup: a definite `unrated`
      // is already on file — it is why this card is an ask — and the customer
      // has just chosen a score. Refusing to send it loses a rating for
      // certain on the strength of a blip that says nothing about whether one
      // exists.
      await endedWithATranscript();
      actions.csatLookupFails = Exception('5xx');

      await cubit.rateSession('s1', rating: 3, comment: 'ok');
      await settle();

      expect(actions.submitted, <List<Object?>>[
        <Object?>['s1', 3, 'ok']
      ]);
    });
  });

  group('ending a conversation', () {
    test('raises the question keyed by the session it is about', () async {
      client.emitSession(testSession(status: ChatStatus.assigned));
      await settle();

      cubit.openEndConversation();

      expect(
        cubit.state.activeSurface,
        const ConfirmEndSurface(sessionId: 's1'),
      );
      expect(cubit.state.screen, ScreenName.conversation);
    });

    test('asks nothing when there is no session, and nothing to close it with',
        () async {
      cubit.openEndConversation();
      expect(cubit.state.activeSurface, isNull);

      final ChatWidgetCubit unwired = ChatWidgetCubit(client: client);
      client.emitSession(testSession(status: ChatStatus.assigned));
      await settle();
      unwired.openEndConversation();
      expect(unwired.state.activeSurface, isNull);
      await unwired.close();
    });

    test('confirming closes the real session and hands the slot back',
        () async {
      client.emitSession(testSession(status: ChatStatus.assigned));
      client.emitMessage(testMessage(id: 'm1'));
      await settle();
      cubit.openEndConversation();

      await cubit.confirmEndConversation('s1');
      await settle();

      expect(actions.closed, <String>['s1']);
      expect(cubit.state.activeSurface, isNull);

      // The terminal status arrives on the SOCKET, not from the REST result —
      // and the release's own re-sync is what raises the rating card that
      // became due behind the question.
      client.emitSession(testSession(status: ChatStatus.closed));
      await settle();
      expect(card(), const CsatSurface(sessionId: 's1', alreadyRated: false));
    });

    test('a rejected close keeps the question up and closes nothing', () async {
      client.emitSession(testSession(status: ChatStatus.assigned));
      await settle();
      cubit.openEndConversation();
      actions.closeFails = Exception('network down');

      await expectLater(
        cubit.confirmEndConversation('s1'),
        throwsA(isA<Exception>()),
      );

      expect(actions.closed, isEmpty);
      expect(
        cubit.state.activeSurface,
        const ConfirmEndSurface(sessionId: 's1'),
      );
    });

    test('cancelling gives the conversation back', () async {
      client.emitSession(testSession(status: ChatStatus.assigned));
      await settle();
      cubit.openEndConversation();

      cubit.cancelEndConversation();

      expect(cubit.state.activeSurface, isNull);
      expect(actions.closed, isEmpty);
    });
  });

  group('reopening an ended conversation', () {
    test('calls the real route, never a client-side re-enable', () async {
      await endedWithATranscript();
      await cubit.reopenEndedSession();

      expect(actions.reopened, <String>['s1']);
      expect(client.joinedSessionIds, <String>['s1']);
    });

    // Reopen converges onto an already-active session and answers with THAT
    // one's id — the ordinary outcome when another tab got there first.
    test('FOLLOWS the id it is answered with, not the one it asked for',
        () async {
      await endedWithATranscript();
      actions.reopenSettlesAs = 's-other';

      await cubit.reopenEndedSession();

      expect(actions.reopened, <String>['s1']);
      expect(client.joinedSessionIds, <String>['s-other']);
    });

    test('joins nothing when the reopen rejects', () async {
      await endedWithATranscript();
      actions.reopenFails = Exception('nope');

      await expectLater(
        cubit.reopenEndedSession(),
        throwsA(isA<Exception>()),
      );
      expect(client.joinedSessionIds, isEmpty);
    });

    test('a parked session is not reopenable from here — it never ended',
        () async {
      client.emitSession(testSession(status: ChatStatus.assigned));
      client.emitSessionClosed('s1', CloseReason.switched);
      client.emitSession(testSession(status: ChatStatus.closed));
      await settle();

      await cubit.reopenEndedSession();
      expect(actions.reopened, isEmpty);
    });
  });

  group('with no ChatSessionActions wired up', () {
    test('the feature is OFF, not broken', () async {
      final ChatWidgetCubit unwired = ChatWidgetCubit(client: client);
      client.emitSession(testSession(status: ChatStatus.assigned));
      client.emitMessage(testMessage(id: 'm1'));
      await settle();
      client.emitSession(testSession(status: ChatStatus.resolved));
      await settle();

      // No card — a survey whose submit silently discarded the answer would
      // be worse than no survey.
      expect(unwired.state.activeSurface, isNull);
      expect(unwired.state.csatBySession, isEmpty);
      // The footer still stands: it needs nothing but the reopen callback,
      // and a dead composer over a terminal thread is the bug it closes.
      expect(unwired.endedFooterDue, isTrue);

      await unwired.rateSession('s1', rating: 5);
      expect(actions.submitted, isEmpty);
      await unwired.close();
    });
  });

  group('outbound typing', () {
    test('reaches the client', () {
      cubit.startTyping();
      cubit.startTyping();
      expect(client.startTypingCalls, 2);
    });

    // A typing INTENT that fails must never block the keystroke that
    // triggered it.
    test('a throwing send does not take the keystroke down with it', () {
      client.startTypingThrows = Exception('socket went away');
      expect(cubit.startTyping, returnsNormally);
    });
  });
}
