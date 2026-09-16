// What a customer sees when the conversation on screen is REPLACED.
//
// The reported bug, from an app developer testing against a live server, on
// its second round: pressing "new conversation" lands on the OLD chat, and
// opening ANY past conversation shows the SAME (previous) transcript. The
// wire was already fixed — `startConversationFrom` really does ask the
// server to mint a new session (see start_new_conversation_wire_test.dart) —
// so the server side was right and the PAINT was wrong: `_byId`, the Cubit's
// message store, was written on every message and cleared by nothing, so the
// snapshot for the new conversation swapped `state.session` and left the
// previous conversation's transcript sitting under the new id.
//
// The rule these tests pin is the one `createChatClient`'s `commitSession`
// states in packages/core: identity and data move in ONE write, a snapshot
// for a DIFFERENT id is a replacement and clears the per-session
// projections, and "a snapshot for the session ALREADY on screen is a
// refresh, not a replacement, and clears nothing."

import 'dart:async';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/remote_config_fixtures.dart';
import 'fake_widget_chat_client.dart';

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(client: client, initialConfig: testRemoteConfig());
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  /// Puts the customer INSIDE a conversation with a transcript on screen —
  /// the state the bug is reported from. Pumped for the same reason
  /// start_new_conversation_wire_test.dart pumps: both arrive on streams, so
  /// without it the Cubit has not folded either yet.
  Future<void> openWithTranscript({
    String id = 's1',
    String messageId = 'm1',
  }) async {
    cubit.openConversation(id);
    client.emitSession(testSession(id: id));
    client.emitMessage(
      testMessage(id: messageId, content: 'the previous conversation'),
    );
    await pumpEventQueue();
  }

  group('a snapshot for a DIFFERENT session replaces what is on screen', () {
    test('the previous conversation\'s transcript does not come with it',
        () async {
      await openWithTranscript();
      // The baseline the assertion below is measured against: there really is
      // a transcript to leave behind, so its absence afterwards means
      // something.
      expect(cubit.state.messages, hasLength(1),
          reason: 'the old transcript never got on screen');

      client.emitSession(testSession(id: 's2'));
      await pumpEventQueue();

      expect(cubit.state.session?.sessionId, 's2');
      // The whole bug in one assertion: without the reset the customer is
      // looking at conversation s1's messages under conversation s2's id.
      expect(cubit.state.messages, isEmpty,
          reason: 'the replaced conversation\'s transcript is still painted');
    });
  });

  // ── Characterization ───────────────────────────────────────────────
  //
  // These pin behaviour that was ALREADY correct before the reset above
  // existed — the pre-change `_onSession` cleared nothing at all, so a
  // same-id snapshot trivially preserved everything. They are here because
  // the reset is what could break it, and they passed on the first run by
  // design. That is not a missing RED: they are the guard on the new
  // branch's condition, not a test for new behaviour.
  group('a snapshot for the session ALREADY on screen is a refresh', () {
    test('and clears nothing', () async {
      await openWithTranscript();

      // The same conversation, said again — the server repeating itself is
      // ordinary live traffic, not a replacement.
      client.emitSession(testSession(id: 's1', status: ChatStatus.assigned));
      await pumpEventQueue();

      expect(cubit.state.session?.sessionId, 's1');
      expect(cubit.state.messages, hasLength(1),
          reason: 'a refresh threw the transcript away');
    });

    test('so ending a conversation still leaves something to rate', () async {
      // The case that makes the id guard load-bearing rather than tidy.
      // Ending a conversation pushes a same-id snapshot with a terminal
      // status, and `dueCsatCard` returns null on `state.messages.isEmpty` —
      // an empty transcript has nothing to rate. Clear on this snapshot and
      // the rating survey silently disappears for every conversation the
      // customer ends. (The card itself, which needs a `CsatMachine`, is
      // covered in test/ui/csat/csat_surface_test.dart; this pins the
      // precondition that file's `endedWithATranscript` relies on.)
      await openWithTranscript();

      client.emitSession(testSession(id: 's1', status: ChatStatus.resolved));
      await pumpEventQueue();

      expect(cubit.state.session?.status, ChatStatus.resolved);
      expect(cubit.state.messages, isNotEmpty,
          reason: 'the ended conversation has nothing left to rate');
    });
  });

  // The other half of the same reset, at the other end of the round trip.
  //
  // `_onSession` above can only act when a snapshot ARRIVES, and minting a
  // session is a round trip: `startNewSession` resolves on the new session's
  // `connection.ack`. So between the customer pressing Start and the server
  // answering, the conversation they asked to leave is still the one on
  // screen — for the whole flight. The opening-line sends that follow
  // populate the now-empty transcript normally.
  group('asking for a new conversation clears the one being left', () {
    test('before the mint, not after it lands', () async {
      await openWithTranscript();
      expect(cubit.state.messages, hasLength(1),
          reason: 'the old transcript never got on screen');

      // Held open: this is the window the customer actually watches, and a
      // reset that waited for the ack would leave the old conversation
      // painted for the whole of it.
      final Completer<void> ack = Completer<void>();
      client.newSessionGate = ack;
      final Future<void> started =
          cubit.startConversationFrom(message: 'My order is late');
      await pumpEventQueue();

      expect(client.newSessionTopics, hasLength(1),
          reason: 'the mint is not actually in flight');
      expect(cubit.state.messages, isEmpty,
          reason: 'the conversation being left is still on screen mid-mint');

      ack.complete();
      await started;
    });

    test('leaving only the opening line once it goes out', () async {
      await openWithTranscript();

      await cubit.startConversationFrom(message: 'My order is late');
      await pumpEventQueue();

      // The fake echoes each send back on the message stream, the way the
      // real client's optimistic echo does — so what is on screen here is
      // exactly what the customer would see.
      expect(
        cubit.state.messages.map((ChatMessage m) => m.content),
        <String>['My order is late'],
      );
    });

    test('and drops a reply target that belonged to it', () async {
      // Not cosmetic: `sendMessage` reads `state.replyingTo` and carries it
      // on the frame, so a target that survived the switch would make the
      // customer's next message a reply to a message in a conversation they
      // have left.
      await openWithTranscript();
      cubit.replyTo(const ReplyTarget(
        messageId: 'm1',
        senderName: 'Support',
        excerpt: 'the previous conversation',
      ));
      expect(cubit.state.replyingTo, isNotNull);

      await cubit.startConversationFrom(message: 'My order is late');
      await pumpEventQueue();

      expect(cubit.state.replyingTo, isNull);
      expect(client.sentReplyToMessageId, everyElement(isNull));
    });
  });
}
