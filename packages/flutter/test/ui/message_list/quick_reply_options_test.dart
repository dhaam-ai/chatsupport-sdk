// Reproduces `quick-replies.test.ts` in full — the handoff filter that was
// missing in Dart and is a live defect.
//
// The rule under test: a bot-suggested reply matching the tenant's
// `behaviour.handoffKeywords` must not render. Escalation is keyword-only by
// the owner's call — the visible "Talk to a human" button was removed — and a
// chip that escalates when tapped IS that button back under a per-reply,
// LLM-authored name. The judge is `asksForAHuman` itself, imported from
// `dhaam_chat`, so "would tapping escalate?" and "should this render?"
// cannot drift apart.
//
// The shape rules (`readQuickReplies` caps, dedup, the newest-message gate)
// keep their existing coverage in `test/ui/quick_replies_test.dart`; this
// file adds the filter and the gates that file could not express.

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../state/fake_widget_chat_client.dart';

/// The console's own shipped default list, lower-cased as the parser
/// leaves it — `quick-replies.test.ts`'s `KEYWORDS`.
const List<String> _keywords = <String>[
  'agent',
  'human',
  'person',
  'speak to someone',
];

List<String> _read(List<Object?> options, {List<String> keywords = _keywords}) {
  return readQuickReplies(
    <String, Object?>{'options': options},
    handoffKeywords: keywords,
  );
}

void main() {
  group('readQuickReplies handoff filter', () {
    test('drops a suggestion that matches a handoff keyword', () {
      expect(
        _read(<Object?>['Track my order', 'Talk to a person', 'Refund status']),
        <String>['Track my order', 'Refund status'],
      );
    });

    for (final String label in <String>[
      'Talk to a human',
      'Speak to an agent',
      'Connect me with a person',
      'speak to someone',
    ]) {
      test('drops "$label" against the default keyword list', () {
        expect(_read(<Object?>[label]), isEmpty);
      });
    }

    test('keeps a suggestion that only contains a keyword inside a word', () {
      // The same word-boundary contract as the composer: "urgent" contains
      // "agent", and tapping it would not escalate either.
      expect(_read(<Object?>['Mark as urgent']), <String>['Mark as urgent']);
    });

    test('filters nothing when the tenant has no handoff keywords', () {
      final List<Object?> options = <Object?>[
        'Talk to a human',
        'Track my order',
      ];
      expect(
        _read(options, keywords: const <String>[]),
        <String>['Talk to a human', 'Track my order'],
      );
      // ...and the parameter is optional, for callers with no keyword source.
      expect(
        readQuickReplies(<String, Object?>{'options': options}),
        <String>['Talk to a human', 'Track my order'],
      );
    });

    test('still enforces the shape rules alongside the filter', () {
      expect(
        _read(<Object?>['Talk to an agent', '  ', 'Refund', 'Refund', 42]),
        <String>['Refund'],
      );
    });

    test('a dropped handoff chip does not consume one of the six slots', () {
      final List<Object?> options = <Object?>[
        'Talk to a human',
        for (int i = 0; i < kMaxQuickReplies; i += 1) 'option $i',
      ];
      expect(_read(options), hasLength(kMaxQuickReplies));
      expect(_read(options), isNot(contains('Talk to a human')));
    });
  });

  group('quickRepliesFor gates', () {
    test('passes the keywords through to the newest message', () {
      final List<ChatMessage> messages = <ChatMessage>[
        testMessage(
          id: 'm1',
          metadata: <String, Object?>{
            'options': <Object?>['Track my order', 'Speak to an agent'],
          },
        ),
      ];
      expect(
        quickRepliesFor(messages, handoffKeywords: _keywords),
        <String>['Track my order'],
      );
    });

    test('a closed session renders no chips — a dead control', () {
      final List<ChatMessage> messages = <ChatMessage>[
        testMessage(
          id: 'm1',
          metadata: <String, Object?>{
            'options': <Object?>['Track my order'],
          },
        ),
      ];
      expect(quickRepliesFor(messages), <String>['Track my order']);
      expect(quickRepliesFor(messages, sessionClosed: true), isEmpty);
    });
  });
}
