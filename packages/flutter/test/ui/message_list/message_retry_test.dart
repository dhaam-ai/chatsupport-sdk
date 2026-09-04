// The Retry affordance, end to end and for the first time.
//
// ── What was wrong, and what it cost ────────────────────────────────────
//
// T9 built the button and five per-reason sentences against
// `MessageListInputs.failures`, a map the caller had to fill. Nothing could:
// the reason and the `retryable` verdict were computed inside `ChatClient`
// and never left a private map, so the only way to discover retryability was
// to CALL `retry()` — after the customer had already pressed a button that
// should never have been drawn. Every one of those sentences, and the button,
// rendered nothing at all (D17, D27).
//
// So the assertions that matter here are not "the widget draws a button".
// They are: a RETRYABLE failure offers Retry and a NON-RETRYABLE one does not,
// both state their own distinct reason, and the press reaches the client under
// the ORIGINAL message id — driven by a message that travelled the real path
// from the client's stream, through the Cubit, to the transcript.
//
// ── The one hop this file cannot own ────────────────────────────────────
//
// `ConversationScreen` builds `MessageListCallbacks` and is another node's
// file this wave. `_onRetry` below is the exact closure that has to land in
// it; these tests pin the contract it must satisfy, so the handover is one
// verified expression rather than a described intention.
library;

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';

const String _me = '';

/// THE closure `ConversationScreen` must install on `onRetry`.
///
/// A refusal is reported rather than dropped: nothing visible changes on one
/// — the message stays failed, which is true — so being told is the only way
/// a host can say anything about it. A success needs no branch, because the
/// client re-emits the message as pending and the transcript repaints itself.
void Function(ChatMessage) _onRetry(
  ChatWidgetCubit cubit,
  void Function(Object, StackTrace) report,
) {
  return (ChatMessage message) {
    final RetryOutcome outcome = cubit.retryMessage(message.id);
    if (outcome is RetryRefused) {
      report(
        StateError('retry refused: ${outcome.reason.name}'),
        StackTrace.current,
      );
    }
  };
}

/// Rebuilds the transcript from the Cubit's own state on every emission —
/// the same relationship `ConversationScreen` has to it, without dragging in
/// the surfaces, the composer and the app bar this file is not about.
class _TranscriptHost extends StatefulWidget {
  const _TranscriptHost({
    required this.cubit,
    required this.reported,
  });

  final ChatWidgetCubit cubit;
  final List<Object> reported;

  @override
  State<_TranscriptHost> createState() => _TranscriptHostState();
}

class _TranscriptHostState extends State<_TranscriptHost> {
  @override
  void initState() {
    super.initState();
    widget.cubit.stream.listen((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    return MessageListView(
      inputs: MessageListInputs(
        messages: widget.cubit.state.messages,
        localParticipantId: _me,
      ),
      callbacks: MessageListCallbacks(
        onCopyMessage: (ChatMessage _) async {},
        onQuickReply: (String _) {},
        onRetry: _onRetry(
          widget.cubit,
          (Object e, StackTrace _) => widget.reported.add(e),
        ),
      ),
    );
  }
}

Future<void> _pump(
  WidgetTester tester,
  ChatWidgetCubit cubit,
  List<Object> reported,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: 600,
          child: _TranscriptHost(cubit: cubit, reported: reported),
        ),
      ),
    ),
  );
}

ChatMessage _failed({
  required String id,
  required SendFailureReason reason,
  required bool retryable,
}) =>
    testMessage(
      id: id,
      senderType: SenderType.customer,
      delivery: MessageFailed(reason: reason, retryable: retryable),
    );

Future<void> _flush(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(Duration.zero));
  await tester.pump();
}

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;
  late List<Object> reported;

  setUp(() {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(client: client);
    reported = <Object>[];
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  testWidgets(
      'a retryable failure offers Retry, and the press reaches the client '
      'under the original id', (WidgetTester tester) async {
    client.retryOutcome = RetryRetried(
      _failed(id: 'm1', reason: SendFailureReason.rejected, retryable: true),
    );
    await _pump(tester, cubit, reported);

    client.emitMessage(
      _failed(id: 'm1', reason: SendFailureReason.rejected, retryable: true),
    );
    await _flush(tester);

    expect(find.text('This message could not be sent.'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();

    // The ORIGINAL envelope id (D1), which is what the server dedupes on. A
    // retry that minted a fresh one would add a second dead message to the
    // thread on every press.
    expect(client.retriedIds, <String>['m1']);
    // A success reports nothing: the client's own stream carries the repaint.
    expect(reported, isEmpty);
  });

  testWidgets(
      'a NON-retryable failure states its own reason and offers no button '
      'at all', (WidgetTester tester) async {
    await _pump(tester, cubit, reported);

    client.emitMessage(
      _failed(
        id: 'm1',
        reason: SendFailureReason.sessionClosed,
        retryable: false,
      ),
    );
    await _flush(tester);

    // A DISTINCT sentence, not the generic one — this is the half T9 wrote
    // and could never render.
    expect(
      find.text('This conversation ended before this message could send.'),
      findsOneWidget,
    );
    expect(find.text('This message could not be sent.'), findsNothing);
    // Absent from the tree, not merely styled away: a control the customer
    // can reach and press must be one that can work. Retrying a send the
    // server already refused is refused identically every time.
    expect(find.text('Retry'), findsNothing);
    expect(client.retriedIds, isEmpty);
  });

  testWidgets(
      'the verdict decides, not the reason — same reason, opposite affordance',
      (WidgetTester tester) async {
    // `retryable` is never re-derived from the reason or the code anywhere on
    // this path. Two messages with the SAME reason and opposite verdicts must
    // therefore get opposite buttons.
    await _pump(tester, cubit, reported);

    client.emitMessage(
      _failed(id: 'yes', reason: SendFailureReason.rejected, retryable: true),
    );
    client.emitMessage(
      _failed(id: 'no', reason: SendFailureReason.rejected, retryable: false),
    );
    await _flush(tester);

    expect(find.text('This message could not be sent.'), findsNWidgets(2));
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('a refusal is reported, never mistaken for a success',
      (WidgetTester tester) async {
    // The unpredictable one. `notRetryable` is gated out before the button is
    // drawn, but a connection can drop between drawing it and pressing it —
    // and then nothing at all happens on screen, because the message stays
    // exactly as failed as it was. Silence there is a refusal wearing a
    // success's clothes.
    client.retryOutcome = const RetryRefused(RetryRefusalReason.disconnected);
    await _pump(tester, cubit, reported);

    client.emitMessage(
      _failed(id: 'm1', reason: SendFailureReason.rejected, retryable: true),
    );
    await _flush(tester);
    await tester.tap(find.text('Retry'));
    await tester.pump();

    expect(client.retriedIds, <String>['m1']);
    expect(reported, hasLength(1));
    expect('${reported.single}', contains('disconnected'));
    // And the message is still failed, still offering the button: the record
    // survived the refusal, so the identical press works once the connection
    // is back.
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets(
      'a retried message stops looking failed, with no second copy of that '
      'transition in the Cubit', (WidgetTester tester) async {
    // `retryMessage` emits nothing itself. The transcript clears because the
    // client re-emits the message as pending on the stream the Cubit already
    // listens to — one publisher, so the two cannot drift.
    client.retryOutcome = RetryRetried(
      testMessage(id: 'm1', senderType: SenderType.customer),
    );
    await _pump(tester, cubit, reported);

    client.emitMessage(
      _failed(id: 'm1', reason: SendFailureReason.rejected, retryable: true),
    );
    await _flush(tester);
    expect(find.text('This message could not be sent.'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    // The client's re-emit, which the real one performs inside `retry()`.
    client.emitMessage(
      testMessage(
        id: 'm1',
        senderType: SenderType.customer,
        delivery: MessageDelivery.pending,
      ),
    );
    await _flush(tester);

    expect(find.text('This message could not be sent.'), findsNothing);
    expect(find.text('Retry'), findsNothing);
  });
}
