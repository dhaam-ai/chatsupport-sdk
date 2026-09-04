// The seam, actually joined up: a message carrying an attachment, rendered
// through `MessageListView.attachmentBuilder` by this module's builder.
//
// Lives here rather than in `test/ui/message_list/` because the fill is this
// node's, not T9's — and because T9's files are being read by other nodes in
// the same wave. It asserts the composition, not the projection: what a row
// looks like is `message_list_view_test.dart`'s subject.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

final DateTime _at = DateTime.utc(2026, 8, 19, 10);

const AttachmentMetadata _receipt = AttachmentMetadata(
  url: 'https://cdn.example.com/receipt.pdf',
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  mediaType: 'DOCUMENT',
);

ChatMessage _withAttachment({String content = 'here is the receipt'}) {
  return ChatMessage(
    id: 'm1',
    sessionId: 's1',
    senderId: 'agt_9',
    senderType: SenderType.agent,
    type: MessageType.file,
    content: content,
    seq: 1,
    createdAt: _at,
    delivery: MessageDelivery.confirmed,
    attachment: _receipt,
  );
}

Future<void> _pump(
  WidgetTester tester,
  ChatMessage message, {
  bool wire = true,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: 600,
          child: MessageListView(
            inputs: MessageListInputs(
              messages: <ChatMessage>[message],
              localParticipantId: 'cus_1',
              initialLoaded: true,
            ),
            callbacks: MessageListCallbacks(
              onCopyMessage: (ChatMessage message) async {},
              onQuickReply: (String text) {},
            ),
            attachmentBuilder: wire ? buildAttachmentBubble : null,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('an attachment in the transcript is drawn by this module',
      (WidgetTester tester) async {
    await _pump(tester, _withAttachment());

    expect(find.byType(AttachmentBubble), findsOneWidget);
    expect(find.text('receipt.pdf'), findsOneWidget);
    expect(find.text('2 KB'), findsOneWidget);
  });

  testWidgets('the seam is what puts it there — unwired, nothing renders',
      (WidgetTester tester) async {
    await _pump(tester, _withAttachment(), wire: false);

    // T9 left `attachmentBuilder` null on purpose, and a null one draws
    // nothing rather than a placeholder. This pins that the bubble arrives
    // through the seam and not from somewhere inside the message list.
    expect(find.byType(AttachmentBubble), findsNothing);
    expect(find.text('receipt.pdf'), findsNothing);
  });

  testWidgets('the bubble sits alongside the agent\'s own words',
      (WidgetTester tester) async {
    await _pump(tester, _withAttachment(content: 'here is the receipt'));

    // An agent can send a real caption beside an attachment (§12.10 is about
    // `content` being a PLACEHOLDER equal to `attachment.url`, which this is
    // not). Both have to survive.
    expect(find.byType(AttachmentBubble), findsOneWidget);
    expect(find.text('here is the receipt'), findsOneWidget);
  });

  testWidgets('a bare attachment renders with no stray placeholder text',
      (WidgetTester tester) async {
    // §12.10: a plain attachment arrives with `content` set to
    // `attachment.url` as a placeholder. `visibleContent` strips it, so the
    // bubble should be the attachment alone — never the raw URL as body text.
    await _pump(tester, _withAttachment(content: _receipt.url));

    expect(find.byType(AttachmentBubble), findsOneWidget);
    expect(find.text(_receipt.url), findsNothing);
  });
}
