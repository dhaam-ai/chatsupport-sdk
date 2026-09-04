// Reproduces the gating half of `pre-chat-guest-only.test.ts`: which fields a
// surface draws, and the absent-vs-empty answers distinction. The surface
// PRECEDENCE half (when the standalone gate is allowed up at all) is
// `resolve_product_surface_test.dart`'s, and the wiring half is
// `chat_widget_cubit_test.dart`'s.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/remote_config_fixtures.dart';

RemoteConfig _config({
  bool preChatEnabled = true,
  List<PreChatField> fields = const <PreChatField>[],
}) =>
    testRemoteConfig(preChatEnabled: preChatEnabled, preChatFields: fields);

const PreChatField _name = PreChatField(
  id: 'name',
  label: 'Your name',
  type: PreChatFieldType.text,
  required: true,
);
const PreChatField _email = PreChatField(
  id: 'email',
  label: 'Email',
  type: PreChatFieldType.email,
  required: false,
);
const PreChatField _phone = PreChatField(
  id: 'phone',
  label: 'Phone',
  type: PreChatFieldType.phone,
  required: false,
);

void main() {
  group('isGuest is the profile, not the user id', () {
    test('a visitor with no profile is a guest', () {
      expect(const ChatIdentity().isGuest, isTrue);
      expect(ChatIdentity.guest.isGuest, isTrue);
    });

    // The bug this whole node exists to prevent. Every visitor has a userId,
    // so a gate that keyed on its absence never fired for anybody.
    test('a userId does NOT stop a visitor being a guest', () {
      expect(const ChatIdentity(userId: 'usr_1').isGuest, isTrue);
    });

    test('any profile at all makes a visitor not a guest', () {
      expect(
        const ChatIdentity(profile: ChatParticipantProfile()).isGuest,
        isFalse,
      );
    });

    // A host that knows somebody is signed in but has none of their details
    // has still vouched for them. Presence of the profile is the fact;
    // presence of anything inside it is not.
    test('an empty profile is still a profile', () {
      expect(
        const ChatIdentity(
          userId: 'usr_1',
          profile: ChatParticipantProfile(),
        ).isGuest,
        isFalse,
      );
    });
  });

  group('preChatFieldsToAsk', () {
    test('asks a guest the merchant configured questions', () {
      final List<FieldSpec> asked = preChatFieldsToAsk(
        config: _config(fields: <PreChatField>[_name, _email]),
        isGuest: true,
        alreadyAnswered: false,
      );
      expect(asked.map((FieldSpec f) => f.id), <String>['name', 'email']);
    });

    test('asks a signed-in customer nothing', () {
      expect(
        preChatFieldsToAsk(
          config: _config(fields: <PreChatField>[_name]),
          isGuest: false,
          alreadyAnswered: false,
        ),
        isEmpty,
      );
    });

    test('asks nothing when the merchant toggle is off', () {
      expect(
        preChatFieldsToAsk(
          config: _config(preChatEnabled: false, fields: <PreChatField>[_name]),
          isGuest: true,
          alreadyAnswered: false,
        ),
        isEmpty,
      );
    });

    // The toggle and the field list are two independent console controls, and
    // gating on the toggle alone is what raised an empty form.
    test('asks nothing when the toggle is on but no fields are configured', () {
      expect(
        preChatFieldsToAsk(
          config: _config(),
          isGuest: true,
          alreadyAnswered: false,
        ),
        isEmpty,
      );
    });

    // Once per conversation, not once per repaint — these surfaces rebuild on
    // every state tick.
    test('asks nothing once the customer has answered', () {
      expect(
        preChatFieldsToAsk(
          config: _config(fields: <PreChatField>[_name]),
          isGuest: true,
          alreadyAnswered: true,
        ),
        isEmpty,
      );
    });

    test('carries label, required-ness and keyboard type across', () {
      final List<FieldSpec> asked = preChatFieldsToAsk(
        config: _config(fields: <PreChatField>[_name, _email, _phone]),
        isGuest: true,
        alreadyAnswered: false,
      );
      expect(asked[0].label, 'Your name');
      expect(asked[0].isRequired, isTrue);
      expect(asked[0].type, FieldKind.text);
      expect(asked[1].type, FieldKind.email);
      expect(asked[1].isRequired, isFalse);
      // The one a customer can physically feel getting wrong.
      expect(keyboardTypeFor(asked[2].type), TextInputType.phone);
    });
  });

  group('preChatAnswersFor: absent and empty are different answers', () {
    // Never asked — the merchant collects no details.
    test('no fields shown reports ABSENT', () {
      expect(preChatAnswersFor(const <FieldView>[]), isNull);
    });

    // Asked and declined — a fact about the customer, not the merchant.
    test('fields shown but every optional left blank reports an EMPTY record',
        () {
      final List<FieldView> views = <FieldView>[
        FieldView(toFieldSpec(_email)),
        FieldView(toFieldSpec(_phone)),
      ];
      addTearDown(() {
        for (final FieldView v in views) {
          v.dispose();
        }
      });

      final Map<String, String>? answers = preChatAnswersFor(views);
      expect(answers, isNotNull);
      expect(answers, isEmpty);
    });

    test('an unanswered optional is omitted, never sent as an empty string',
        () {
      final FieldView name = FieldView(toFieldSpec(_name));
      final FieldView email = FieldView(toFieldSpec(_email));
      addTearDown(name.dispose);
      addTearDown(email.dispose);
      name.controller.text = '  Ada  ';

      expect(
        preChatAnswersFor(<FieldView>[name, email]),
        <String, String>{'name': 'Ada'},
      );
    });
  });
}
