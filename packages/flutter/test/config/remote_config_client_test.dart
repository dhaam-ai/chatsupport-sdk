// Mirrors the cases packages/widget/test/remote-config.test.ts's
// 'fetchRemoteConfig' and 'mount and offline gating' describe blocks cover,
// minus the ones that only make sense in a browser (CORS, the HTTP cache) —
// see remote_config_client.dart's header for exactly which two those are.

import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final PublishableKey _key = PublishableKey.parse('dhp_test_abc123');

Object _validBody({Object? appearance, Object? behaviour}) => {
      'data': {
        if (appearance != null) 'appearance': appearance,
        if (behaviour != null) 'behaviour': behaviour,
      },
    };

void main() {
  group('fetchRemoteConfig', () {
    test('sends the publishable key as a header, never in the URL', () async {
      http.Request? seen;
      final client = MockClient((request) async {
        seen = request;
        return http.Response(jsonEncode(_validBody()), 200);
      });

      await fetchRemoteConfig(apiUrl: 'https://api.example.com', publishableKey: _key, client: client);

      expect(seen, isNotNull);
      expect(seen!.headers['X-Publishable-Key'], 'dhp_test_abc123');
      expect(seen!.url.toString(), isNot(contains('dhp_test_abc123')));
    });

    test('requests the fixed config path off the given origin', () async {
      Uri? seenUri;
      final client = MockClient((request) async {
        seenUri = request.url;
        return http.Response(jsonEncode(_validBody()), 200);
      });

      await fetchRemoteConfig(apiUrl: 'https://api.example.com', publishableKey: _key, client: client);

      expect(seenUri.toString(), 'https://api.example.com/chat-services/api/v1/widget/config');
    });

    test('strips a trailing slash off apiUrl rather than doubling it', () async {
      Uri? seenUri;
      final client = MockClient((request) async {
        seenUri = request.url;
        return http.Response(jsonEncode(_validBody()), 200);
      });

      await fetchRemoteConfig(apiUrl: 'https://api.example.com/', publishableKey: _key, client: client);

      expect(seenUri.toString(), 'https://api.example.com/chat-services/api/v1/widget/config');
    });

    test('parses a well-formed 200 into a RemoteConfig', () async {
      final client = MockClient(
        (request) async => http.Response(jsonEncode(_validBody(appearance: {'accent': '#ff0000'})), 200),
      );

      final config = await fetchRemoteConfig(apiUrl: 'https://api.example.com', publishableKey: _key, client: client);

      expect(config, isNotNull);
      expect(config!.accent, '#ff0000');
    });

    test('returns null on a non-2xx status rather than throwing', () async {
      final client = MockClient((request) async => http.Response('nope', 404));

      final config = await fetchRemoteConfig(apiUrl: 'https://api.example.com', publishableKey: _key, client: client);

      expect(config, isNull);
    });

    test('returns null when the body is not JSON', () async {
      final client = MockClient((request) async => http.Response('<html>not json</html>', 200));

      final config = await fetchRemoteConfig(apiUrl: 'https://api.example.com', publishableKey: _key, client: client);

      expect(config, isNull);
    });

    test('returns null on a network error rather than throwing', () async {
      final client = MockClient((request) async => throw Exception('connection refused'));

      final config = await fetchRemoteConfig(apiUrl: 'https://api.example.com', publishableKey: _key, client: client);

      expect(config, isNull);
    });

    test('gives up after the timeout instead of hanging the widget forever', () async {
      final client = MockClient((request) async {
        await Future<void>.delayed(const Duration(milliseconds: 50));
        return http.Response(jsonEncode(_validBody()), 200);
      });

      final config = await fetchRemoteConfig(
        apiUrl: 'https://api.example.com',
        publishableKey: _key,
        client: client,
        timeout: const Duration(milliseconds: 5),
      );

      expect(config, isNull);
    });
  });

  group('shouldMount / shouldCollectOffline / isOutOfHours', () {
    RemoteConfig withOverrides({bool? enabled, OfflineMode? offlineMode, bool? isOpenNow}) {
      return RemoteConfig(
        enabled: enabled ?? defaultRemoteConfig.enabled,
        accent: null,
        title: null,
        theme: null,
        position: null,
        offsetX: null,
        offsetY: null,
        launcher: null,
        launcherLabel: null,
        launcherIcon: const LauncherIcon(),
        launcherShadow: const LauncherShadow(),
        design: null,
        header: const HeaderAppearance(),
        logoUrl: null,
        subtitle: null,
        avatarMode: null,
        avatarInitials: null,
        showBranding: null,
        brandingText: null,
        brandingUrl: null,
        thread: const ThreadAppearance(),
        cornerRadius: null,
        fontFamily: null,
        greeting: null,
        greetingDelaySec: 0,
        autoOpen: AutoOpen.never,
        autoOpenDelaySec: 12,
        typingIndicator: true,
        sound: false,
        transcriptEmail: false,
        consentRequired: false,
        consentText: null,
        handoffKeywords: const <String>[],
        reportIssue: false,
        preChatEnabled: false,
        preChatFields: const <PreChatField>[],
        commonQuestions: const <CommonQuestion>[],
        conversationTopics: const <ConversationTopic>[],
        csatStyle: CsatStyle.stars,
        offlineMode: offlineMode ?? defaultRemoteConfig.offlineMode,
        offlineMessage: null,
        fileUploads: true,
        isOpenNow: isOpenNow,
        flows: const <PublishedFlow>[],
        botDisplayName: null,
        publishedVersion: 0,
      );
    }

    test('does not mount when the merchant disabled the widget', () {
      expect(shouldMount(withOverrides(enabled: false)), isFalse);
    });

    test('does not mount when hideWidget and the team is closed', () {
      expect(
        shouldMount(withOverrides(offlineMode: OfflineMode.hideWidget, isOpenNow: false)),
        isFalse,
      );
    });

    test('still mounts under hideWidget while the team is open', () {
      expect(
        shouldMount(withOverrides(offlineMode: OfflineMode.hideWidget, isOpenNow: true)),
        isTrue,
      );
    });

    test('treats an unknown open-state (null) as always open', () {
      expect(
        shouldMount(withOverrides(offlineMode: OfflineMode.hideWidget, isOpenNow: null)),
        isTrue,
      );
    });

    test('collects an offline message only under collectMessage while closed', () {
      expect(
        shouldCollectOffline(withOverrides(offlineMode: OfflineMode.collectMessage, isOpenNow: false)),
        isTrue,
      );
      expect(
        shouldCollectOffline(withOverrides(offlineMode: OfflineMode.showMessage, isOpenNow: false)),
        isFalse,
      );
      expect(
        shouldCollectOffline(withOverrides(offlineMode: OfflineMode.collectMessage, isOpenNow: true)),
        isFalse,
      );
    });

    test('mounts on the defaults a failed fetch leaves behind', () {
      expect(shouldMount(defaultRemoteConfig), isTrue);
      expect(isOutOfHours(defaultRemoteConfig), isFalse);
    });
  });
}
