// The structured half of a pre-chat send.
//
// `widget.ts`'s `sendPreChatDetails` puts the answers on the wire TWICE in
// one frame — as prose the agent reads, and as
// `metadata: {kind: 'pre_chat', answers}` that chat-service folds into a
// customer-asserted contact on the session. Until this slice the Dart widget
// layer had no way to carry the second half at all: `WidgetChatClient.
// sendMessage` took only `content`/`replyToMessageId`, so the answers were
// resolved, stored on state, and then reached the agent as text and nothing
// else — the lines read, the contact never created.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/remote_config_fixtures.dart';
import 'fake_widget_chat_client.dart';

const List<PreChatField> _fields = <PreChatField>[
  PreChatField(
    id: 'name',
    label: 'Your name',
    type: PreChatFieldType.text,
    required: false,
  ),
  PreChatField(
    id: 'order',
    label: 'Order number',
    type: PreChatFieldType.text,
    required: false,
  ),
];

void main() {
  late FakeWidgetChatClient client;
  late ChatWidgetCubit cubit;

  setUp(() {
    client = FakeWidgetChatClient();
    cubit = ChatWidgetCubit(
      client: client,
      initialConfig: testRemoteConfig(
        preChatEnabled: true,
        preChatFields: _fields,
      ),
    );
  });

  tearDown(() async {
    await cubit.close();
    await client.dispose();
  });

  group('pre-chat answers on the wire', () {
    test('the standalone gate sends prose and structure in ONE frame',
        () async {
      await cubit.submitPreChat(<String, String>{'name': 'Jordan'});

      expect(client.sentContent, <String>['Your name: Jordan']);
      // One send, not two: the transcript and the server's structured read
      // can never describe different answers if they arrive together.
      expect(client.sentMetadata, hasLength(1));
      expect(client.sentMetadata.single, <String, Object?>{
        'kind': 'pre_chat',
        'answers': <String, String>{'name': 'Jordan'},
      });
    });

    test('carries the FULL answers map, not just the fields it wrote lines for',
        () {
      // The prose is the human-readable filter; the structured copy is the
      // raw record, and `widget.ts` passes `answers` whole for exactly that
      // reason.
      cubit.startConversationFrom(
        message: 'My order is late',
        answers: <String, String>{'name': 'Jordan', 'unknown_id': 'kept'},
      );

      expect(client.sentContent.first, 'Your name: Jordan');
      expect(
        client.sentMetadata.first!['answers'],
        <String, String>{'name': 'Jordan', 'unknown_id': 'kept'},
      );
    });

    test('the opening line itself carries no metadata — it is not an answer',
        () {
      cubit.startConversationFrom(
        message: 'My order is late',
        answers: <String, String>{'name': 'Jordan'},
      );

      expect(client.sentContent, <String>[
        'Your name: Jordan',
        'My order is late',
      ]);
      expect(client.sentMetadata, <Map<String, Object?>?>[
        <String, Object?>{
          'kind': 'pre_chat',
          'answers': <String, String>{'name': 'Jordan'},
        },
        null,
      ]);
    });

    test('an all-blank form sends nothing at all — no prose, no metadata',
        () async {
      // The "asked and declined" case. A frame carrying only
      // `{kind: 'pre_chat', answers: {}}` would assert a structured claim
      // that was never made.
      await cubit.submitPreChat(const <String, String>{});

      expect(client.sentContent, isEmpty);
      expect(client.sentMetadata, isEmpty);
      expect(cubit.state.preChatAnswered, isTrue);
    });

    test('an ordinary send carries none', () {
      cubit.sendMessage('just a message');

      expect(client.sentMetadata, <Map<String, Object?>?>[null]);
    });
  });
}
