// Mirrors the edge cases packages/widget/test/remote-config.test.ts already
// found worth asserting on for parseRemoteConfig — not copied verbatim (this
// is Dart, and the merge/fetch describe blocks in that file test behaviour
// this package does not port, see remote_config.dart's header) but the same
// defensive-parsing cases, because they are cases a real published config was
// once caught doing.

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _body({Object? appearance, Object? behaviour, Map<String, Object?> data = const {}}) {
  return {
    'data': {
      if (appearance != null) 'appearance': appearance,
      if (behaviour != null) 'behaviour': behaviour,
      ...data,
    },
  };
}

void main() {
  group('parseRemoteConfig — envelope shape', () {
    test('null for a body with no data', () {
      expect(parseRemoteConfig(<String, Object?>{}), isNull);
      expect(parseRemoteConfig('not a map'), isNull);
      expect(parseRemoteConfig(null), isNull);
    });

    test('null when data is not an object', () {
      expect(parseRemoteConfig(<String, Object?>{'data': 'nope'}), isNull);
    });

    test('defaults every leaf when appearance and behaviour are absent entirely', () {
      final config = parseRemoteConfig(_body());
      expect(config, isNotNull);
      expect(config!.accent, isNull);
      expect(config.theme, isNull);
      expect(config.autoOpen, AutoOpen.never);
      expect(config.csatStyle, CsatStyle.stars);
      expect(config.offlineMode, OfflineMode.showMessage);
      expect(config.commonQuestions, isEmpty);
      expect(config.handoffKeywords, isEmpty);
    });

    test('survives appearance/behaviour being the wrong type entirely', () {
      final config = parseRemoteConfig(_body(appearance: 'nope', behaviour: 42));
      expect(config, isNotNull);
      expect(config!.accent, isNull);
      expect(config.greeting, isNull);
    });
  });

  group('parseRemoteConfig — the data-vs-appearance-vs-behaviour split', () {
    // enabled, offlineMode, isOpenNow, flows, botDisplayName and
    // publishedVersion read from `data` directly, NOT from appearance or
    // behaviour — verified against remote-config.ts field by field. Getting
    // this wrong is invisible in a happy-path test that sets every field, so
    // each is asserted from a body that sets ONLY that one field at the data
    // level.
    test('enabled reads from data, not appearance or behaviour', () {
      final config = parseRemoteConfig(_body(data: {'enabled': false}));
      expect(config!.enabled, isFalse);
    });

    test('offlineMode reads from data, not behaviour', () {
      final config = parseRemoteConfig(
        _body(behaviour: {'offlineMode': 2}, data: {'offlineMode': 3}),
      );
      // The behaviour-level one is noise a wrong implementation would read;
      // the real source is `data`.
      expect(config!.offlineMode, OfflineMode.hideWidget);
    });

    test('isOpenNow, flows, botDisplayName and publishedVersion read from data', () {
      final config = parseRemoteConfig(_body(data: {
        'isOpenNow': false,
        'flows': [
          {'id': 'f1', 'name': 'Offline', 'trigger': 4},
        ],
        'botDisplayName': 'Nova',
        'publishedVersion': 7,
      }));
      expect(config!.isOpenNow, isFalse);
      expect(config.flows, hasLength(1));
      expect(config.flows.single.id, 'f1');
      expect(config.botDisplayName, 'Nova');
      expect(config.publishedVersion, 7);
    });
  });

  group('parseRemoteConfig — appearance leaves', () {
    test('reads a full appearance object', () {
      final config = parseRemoteConfig(_body(appearance: {
        'accent': '#112233',
        'title': 'Support',
        'theme': 'dark',
        'position': 'bottom-left',
        'offsetX': 12,
        'offsetY': 8,
        'launcher': 'tab',
        'design': 'hero',
        'avatarMode': 'logo',
        'cornerRadius': 16,
        'fontFamily': 'Inter',
      }));
      expect(config!.accent, '#112233');
      expect(config.title, 'Support');
      expect(config.theme, WidgetTheme.dark);
      expect(config.position, WidgetPosition.bottomLeft);
      expect(config.offsetX, 12);
      expect(config.offsetY, 8);
      expect(config.launcher, LauncherStyle.tab);
      expect(config.design, WidgetDesign.hero);
      expect(config.avatarMode, AvatarMode.logo);
      expect(config.cornerRadius, 16);
      expect(config.fontFamily, 'Inter');
    });

    test('treats an empty-string accent or title as unset, not as a blank value', () {
      final config = parseRemoteConfig(_body(appearance: {'accent': '', 'title': '   '}));
      expect(config!.accent, isNull);
      expect(config.title, isNull);
    });

    test('keeps a zero corner radius, which is a real choice and not "unset"', () {
      final config = parseRemoteConfig(_body(appearance: {'cornerRadius': 0}));
      expect(config!.cornerRadius, 0);
    });

    test('keeps a zero offset, which pins the launcher flush to the edge', () {
      final config = parseRemoteConfig(_body(appearance: {'offsetX': 0, 'offsetY': 0}));
      expect(config!.offsetX, 0);
      expect(config.offsetY, 0);
    });

    test('an unrecognised enum value degrades to null, not a guess', () {
      final config = parseRemoteConfig(_body(appearance: {'theme': 'psychedelic'}));
      expect(config!.theme, isNull);
    });
  });

  group('parseRemoteConfig — launcherIcon / launcherShadow', () {
    test('keeps only the launcherIcon fields it could actually read', () {
      final config = parseRemoteConfig(_body(appearance: {
        'launcherIcon': {'source': 'emoji', 'emoji': 42, 'library': 'chat-bubble'},
      }));
      expect(config!.launcherIcon.source, LauncherIconSource.emoji);
      expect(config.launcherIcon.emoji, isNull); // wrong type, dropped
      expect(config.launcherIcon.library, 'chat-bubble');
    });

    test('keeps a launcherShadow the merchant switched OFF, rather than reading it as unset', () {
      final config = parseRemoteConfig(_body(appearance: {
        'launcherShadow': {'enabled': false, 'intensity': 0},
      }));
      expect(config!.launcherShadow.enabled, isFalse);
      expect(config.launcherShadow.intensity, 0);
      expect(config.launcherShadow.isEmpty, isFalse);
    });

    test('an object-shaped field absent entirely parses to the empty value', () {
      final config = parseRemoteConfig(_body(appearance: const {}));
      expect(config!.launcherIcon.isEmpty, isTrue);
      expect(config.launcherShadow.isEmpty, isTrue);
    });
  });

  group('parseRemoteConfig — header', () {
    test('keeps only the header fields it could actually read', () {
      final config = parseRemoteConfig(_body(appearance: {
        'header': {
          'background': 'gradient',
          'greeting': 'Hi there',
          'gradientStrength': 'not a number',
          'avatars': ['a.png', 42, 'b.png'],
        },
      }));
      expect(config!.header.background, HeaderBackground.gradient);
      expect(config.header.greeting, 'Hi there');
      expect(config.header.gradientStrength, isNull);
      expect(config.header.avatars, ['a.png', 'b.png']);
    });

    test('leaves an absent avatar list absent, not empty', () {
      final config = parseRemoteConfig(_body(appearance: {
        'header': {'greeting': 'Hi'},
      }));
      expect(config!.header.avatars, isNull);
    });

    test('filters a broken avatar out of the row rather than dropping the row', () {
      final config = parseRemoteConfig(_body(appearance: {
        'header': {
          'avatars': [null, 'ok.png', 7],
        },
      }));
      expect(config!.header.avatars, ['ok.png']);
    });
  });

  group('parseRemoteConfig — behaviour leaves', () {
    test('falls back to never for an autoOpen it cannot name', () {
      final config = parseRemoteConfig(_body(behaviour: {'autoOpen': 'sometimes'}));
      expect(config!.autoOpen, AutoOpen.never);
    });

    test('reads delay and exit-intent', () {
      expect(parseRemoteConfig(_body(behaviour: {'autoOpen': 'delay'}))!.autoOpen, AutoOpen.delay);
      expect(
        parseRemoteConfig(_body(behaviour: {'autoOpen': 'exit-intent'}))!.autoOpen,
        AutoOpen.exitIntent,
      );
    });

    test('clamps a delay to the survivable range and rejects negative', () {
      final config = parseRemoteConfig(_body(behaviour: {
        'greetingDelaySec': -5,
        'autoOpenDelaySec': 999999,
      }));
      // Negative falls back to the default; an over-large one clamps to the max.
      expect(config!.greetingDelaySec, defaultRemoteConfig.greetingDelaySec);
      expect(config.autoOpenDelaySec, 3600);
    });

    group('handoff keywords', () {
      test('drops blanks, which would otherwise match everything', () {
        final config = parseRemoteConfig(_body(behaviour: {
          'handoffKeywords': ['refund', '   ', ''],
        }));
        expect(config!.handoffKeywords, ['refund']);
      });

      test('lower-cases, so a visitor\'s capitals still match', () {
        final config = parseRemoteConfig(_body(behaviour: {
          'handoffKeywords': ['REFUND'],
        }));
        expect(config!.handoffKeywords, ['refund']);
      });

      test('de-duplicates what lower-casing collapsed', () {
        final config = parseRemoteConfig(_body(behaviour: {
          'handoffKeywords': ['Refund', 'refund', 'REFUND'],
        }));
        expect(config!.handoffKeywords, ['refund']);
      });

      test('ignores non-string entries rather than stringifying them', () {
        final config = parseRemoteConfig(_body(behaviour: {
          'handoffKeywords': ['refund', 42, null],
        }));
        expect(config!.handoffKeywords, ['refund']);
      });
    });

    test('preChatFields drops entries with no id or no label', () {
      final config = parseRemoteConfig(_body(behaviour: {
        'preChatFields': [
          {'id': 'email', 'label': 'Email', 'type': 'email', 'required': true},
          {'label': 'No id'},
          {'id': 'no-label'},
        ],
      }));
      expect(config!.preChatFields, hasLength(1));
      expect(config.preChatFields.single.id, 'email');
      expect(config.preChatFields.single.type, PreChatFieldType.email);
      expect(config.preChatFields.single.required, isTrue);
    });

    test('preChatFields defaults an unrecognised type to text', () {
      final config = parseRemoteConfig(_body(behaviour: {
        'preChatFields': [
          {'id': 'x', 'label': 'X', 'type': 'fax'},
        ],
      }));
      expect(config!.preChatFields.single.type, PreChatFieldType.text);
    });

    test('commonQuestions drops entries with no id, label or prompt', () {
      final config = parseRemoteConfig(_body(behaviour: {
        'commonQuestions': [
          {'id': 'q1', 'label': 'Shipping?', 'prompt': 'How long does shipping take?'},
          {'id': 'q2', 'label': 'No prompt'},
        ],
      }));
      expect(config!.commonQuestions, hasLength(1));
      expect(config.commonQuestions.single.id, 'q1');
    });

    test('commonQuestions defaults to an empty list when absent, not a built-in list', () {
      final config = parseRemoteConfig(_body());
      expect(config!.commonQuestions, isEmpty);
    });

    test('conversationTopics drops entries with no id or label', () {
      final config = parseRemoteConfig(_body(behaviour: {
        'conversationTopics': [
          {'id': 't1', 'label': 'Delivery issue'},
          {'id': 't2'},
          {'label': 'No id'},
        ],
      }));
      expect(config!.conversationTopics, hasLength(1));
      expect(config.conversationTopics.single.id, 't1');
      expect(config.conversationTopics.single.label, 'Delivery issue');
    });

    test('conversationTopics defaults to an empty list when absent, not an invented one', () {
      final config = parseRemoteConfig(_body());
      expect(config!.conversationTopics, isEmpty);
    });

    test('csatStyle: only "emoji" is not stars', () {
      expect(parseRemoteConfig(_body(behaviour: {'csatStyle': 'emoji'}))!.csatStyle, CsatStyle.emoji);
      expect(parseRemoteConfig(_body(behaviour: {'csatStyle': 'stars'}))!.csatStyle, CsatStyle.stars);
      expect(parseRemoteConfig(_body(behaviour: {'csatStyle': 'thumbs'}))!.csatStyle, CsatStyle.stars);
    });
  });

  group('parseRemoteConfig — flows', () {
    test('drops flows missing an id, name or numeric trigger', () {
      final config = parseRemoteConfig(_body(data: {
        'flows': [
          {'id': 'f1', 'name': 'Welcome', 'trigger': 1},
          {'name': 'No id', 'trigger': 2},
          {'id': 'f3', 'trigger': 3},
          {'id': 'f4', 'name': 'Bad trigger', 'trigger': 'four'},
        ],
      }));
      expect(config!.flows, hasLength(1));
      expect(config.flows.single.id, 'f1');
    });

    test('filters non-string keywords and defaults pagePattern to empty', () {
      final config = parseRemoteConfig(_body(data: {
        'flows': [
          {
            'id': 'f1',
            'name': 'Keyword',
            'trigger': 2,
            'keywords': ['refund', 7, 'cancel'],
          },
        ],
      }));
      expect(config!.flows.single.keywords, ['refund', 'cancel']);
      expect(config.flows.single.pagePattern, '');
    });
  });

  group('parseRemoteConfig — offlineMode', () {
    test('an out-of-range integer falls back to showMessage', () {
      final config = parseRemoteConfig(_body(data: {'offlineMode': 99}));
      expect(config!.offlineMode, OfflineMode.showMessage);
    });

    test('a non-integer falls back to showMessage', () {
      final config = parseRemoteConfig(_body(data: {'offlineMode': 'closed'}));
      expect(config!.offlineMode, OfflineMode.showMessage);
    });

    test('reads all three real values', () {
      expect(parseRemoteConfig(_body(data: {'offlineMode': 1}))!.offlineMode, OfflineMode.showMessage);
      expect(parseRemoteConfig(_body(data: {'offlineMode': 2}))!.offlineMode, OfflineMode.collectMessage);
      expect(parseRemoteConfig(_body(data: {'offlineMode': 3}))!.offlineMode, OfflineMode.hideWidget);
    });
  });

  group('parseRemoteConfig — isOpenNow stays three-valued', () {
    test('absent stays null, not false', () {
      final config = parseRemoteConfig(_body());
      expect(config!.isOpenNow, isNull);
    });

    test('a non-boolean stays null rather than coercing', () {
      final config = parseRemoteConfig(_body(data: {'isOpenNow': 'yes'}));
      expect(config!.isOpenNow, isNull);
    });
  });
}
