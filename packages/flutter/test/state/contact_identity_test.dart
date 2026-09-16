// Forwarding what the HOST already knows about this visitor and this device
// to `POST /identify`.
//
// ── The reported gap, and the boundary it fixes ─────────────────────────
//
// "The integrated developer will append these details to the SDK — we will
// not. We use that detail, send to API backend via SDK." So this package
// ACCEPTS a device id, a push token and a platform and FORWARDS them. It
// discovers nothing: there is no `device_info_plus` here, no Firebase, no
// plugin of any kind added for this, and no place where this package asks a
// platform channel what phone it is running on.
//
// `RestClient.identify`, `RestIdentityProfile` and `RestIdentityDevice`
// already existed in `dhaam_chat_rest` and are unchanged. `packages/flutter`
// simply never called any of them — only the example app knew the route was
// there — so a host holding a device token had nowhere to put it.

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:dhaam_chat_rest/dhaam_chat_rest.dart' show RestClient;
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fake_widget_chat_client.dart';

/// Lets the unawaited identify reach its seam, and its failure reach the
/// error channel, before an assertion looks.
Future<void> settle() async {
  for (int i = 0; i < 4; i += 1) {
    await Future<void>.delayed(Duration.zero);
  }
}

/// What a host that knows its own device hands over. Every value here is the
/// HOST's: this package invents none of them and reads none of them off a
/// platform.
const RestIdentityProfile kHostProfile = RestIdentityProfile(
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  device: RestIdentityDevice(
    deviceId: 'device-7f3a',
    deviceToken: 'fcm-abc123',
    platform: RestDevicePlatform.ios,
  ),
);

void main() {
  late FakeWidgetChatClient client;
  late List<RestIdentityProfile> sent;

  setUp(() {
    client = FakeWidgetChatClient();
    sent = <RestIdentityProfile>[];
  });

  tearDown(() async {
    await client.dispose();
  });

  Future<void> record(RestIdentityProfile profile) async => sent.add(profile);

  /// Captures what this package hands to the HOST's error channel, and puts
  /// the real handler back afterwards.
  List<FlutterErrorDetails> captureErrors() {
    final List<FlutterErrorDetails> reported = <FlutterErrorDetails>[];
    final FlutterExceptionHandler? previous = FlutterError.onError;
    FlutterError.onError = reported.add;
    addTearDown(() => FlutterError.onError = previous);
    return reported;
  }

  test('issues the identify call with exactly the values it was handed',
      () async {
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      contactProfile: kHostProfile,
      contactIdentifier: record,
    );

    await cubit.connect();
    await settle();

    // The SAME object, not a rebuilt one: nothing here re-derives, defaults
    // or normalises a field the host supplied.
    expect(sent, hasLength(1));
    expect(identical(sent.single, kHostProfile), isTrue);

    // And what it puts on the wire. `platform` is lowercase — the route's
    // own spelling, which `RestDevicePlatform` makes impossible to get
    // wrong, and which is a validation failure as `'IOS'`.
    expect(sent.single.toJson(), <String, Object?>{
      'name': 'Ada Lovelace',
      'email': 'ada@example.com',
      'device': <String, Object?>{
        'deviceId': 'device-7f3a',
        'deviceToken': 'fcm-abc123',
        'platform': 'ios',
      },
    });

    await cubit.close();
  });

  test('a rejected identify goes to the HOST and never touches chat',
      () async {
    final List<FlutterErrorDetails> reported = captureErrors();
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      contactProfile: kHostProfile,
      contactIdentifier: (RestIdentityProfile _) async =>
          throw Exception('identify refused'),
    );

    await cubit.connect();
    await settle();

    // The host's channel, where every other error in this class goes —
    // never the customer's screen, and never an unhandled async error that
    // takes the zone down with it.
    expect(reported, hasLength(1));
    expect(reported.single.exception.toString(), contains('identify refused'));

    // And chat is untouched. A CRM upsert is not a precondition for talking
    // to anybody: the socket was opened on the same call that failed here.
    expect(client.connectCalls, 1);
    expect(cubit.state.lastError, isNull);
    expect(cubit.state.suspendReason, isNull);

    await cubit.close();
  });

  test('the device token never reaches the error report', () async {
    final List<FlutterErrorDetails> reported = captureErrors();
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      contactProfile: kHostProfile,
      // A failure that says nothing about the request, which is what
      // `dart_rest`'s own exceptions are: `RestApiException.toString()`
      // deliberately omits the server's text and `RestTransportException`'s
      // omits the cause, precisely because a URL or a body reaches a host's
      // crash reporter from there.
      contactIdentifier: (RestIdentityProfile _) async =>
          throw Exception('upstream unavailable'),
    );

    await cubit.connect();
    await settle();

    // A push credential. The backend's own schema comment says it is never
    // logged, and this is the one place in this package that could have
    // interpolated the profile into a message on its way to a reporter.
    expect(reported, hasLength(1));
    expect(reported.single.toString(), isNot(contains('fcm-abc123')));
    expect(reported.single.exception.toString(), isNot(contains('fcm-abc123')));

    await cubit.close();
  });

  test('connect never waits for it', () async {
    // A capture that never resolves — the shape `setContactInfo`'s own doc
    // warns about, where a permission prompt is answered by nobody. Opening
    // the panel cannot be held behind it.
    final Completer<void> never = Completer<void>();
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      contactProfile: kHostProfile,
      contactIdentifier: (RestIdentityProfile _) => never.future,
    );

    await cubit.connect().timeout(const Duration(seconds: 5));

    expect(client.connectCalls, 1);
    expect(never.isCompleted, isFalse);

    never.complete();
    await settle();
    await cubit.close();
  });

  test('one identify per Cubit — and a REJECTED one is re-armed', () async {
    captureErrors();
    int calls = 0;
    Object? refuse = Exception('CRM down');
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      contactProfile: kHostProfile,
      contactIdentifier: (RestIdentityProfile _) async {
        calls += 1;
        final Object? failure = refuse;
        if (failure != null) throw failure;
      },
    );

    await cubit.connect();
    await settle();
    expect(calls, 1);

    // What "Try again" on the unavailable panel calls. The first upsert
    // failed, so this one is issued: the same rule the session list follows
    // — a failed fetch does not consume the trigger that asked for it.
    refuse = null;
    await cubit.connect();
    await settle();
    expect(calls, 2);

    // And now it has landed. Every later connect sends nothing: the values
    // are the host's and cannot change for this Cubit's lifetime, so a
    // second upsert would carry byte-identical data.
    await cubit.connect();
    await cubit.connect();
    await settle();
    expect(calls, 2);

    await cubit.close();
  });

  test('a host that supplies nothing forwards nothing', () async {
    // Neither half. This is the default every existing caller already has,
    // and it must behave exactly as it did before the parameters existed.
    final ChatWidgetCubit none = ChatWidgetCubit(client: client);
    await none.connect();
    await settle();
    expect(sent, isEmpty);
    expect(client.connectCalls, 1);
    await none.close();

    // A seam with nothing to forward. This package will not invent a
    // profile to fill it — that is the line the whole feature is drawn on.
    final ChatWidgetCubit noValues =
        ChatWidgetCubit(client: client, contactIdentifier: record);
    await noValues.connect();
    await settle();
    expect(sent, isEmpty);
    await noValues.close();

    // Values with nowhere to send them. Off, not broken, and not a crash.
    final ChatWidgetCubit noRoute =
        ChatWidgetCubit(client: client, contactProfile: kHostProfile);
    await noRoute.connect();
    await settle();
    expect(sent, isEmpty);
    await noRoute.close();
  });

  test('a RestClient alone carries it — the host writes no closure', () async {
    // The same `rest:` that fills the session list also fills this, so the
    // mock answers BOTH routes: an empty page for the list (`connect` asks
    // for one on the same call) and the identify receipt for this. Recorded
    // per path rather than in one list, so the assertions below are about
    // the request this test is actually for.
    final List<http.Request> identifies = <http.Request>[];
    final RestClient rest = RestClient(
      apiUrl: 'https://chat.example.test',
      publishableKey: PublishableKey.parse('dhp_test_0123456789abcdefghijklmn'),
      getAccessToken: () async => 'tok',
      httpClient: MockClient((http.Request request) async {
        const Map<String, String> json = <String, String>{
          'content-type': 'application/json'
        };
        if (!request.url.path.endsWith('/identify')) {
          return http.Response(
              '{"success":true,"data":{"sessions":[]}}', 200,
              headers: json);
        }
        identifies.add(request);
        return http.Response(
          '{"success":true,"data":{"contactId":"c1","externalId":"e1",'
          '"lastLoginAt":"2026-01-01T00:00:00Z"}}',
          200,
          headers: json,
        );
      }),
    );

    // Two arguments, no closure: the Cubit builds `restContactIdentifier`
    // for itself, exactly as it builds the session list's and the
    // transcript's REST halves.
    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      rest: rest,
      contactProfile: kHostProfile,
    );

    await cubit.connect();
    await settle();

    expect(identifies, hasLength(1));
    expect(identifies.single.method, 'POST');
    // What actually went over the wire, decoded back — the host's values,
    // and `'ios'` lowercase, which is the route's own spelling and a
    // validation failure as `'IOS'`.
    expect(
      jsonDecode(identifies.single.body),
      <String, Object?>{
        'name': 'Ada Lovelace',
        'email': 'ada@example.com',
        'device': <String, Object?>{
          'deviceId': 'device-7f3a',
          'deviceToken': 'fcm-abc123',
          'platform': 'ios',
        },
      },
    );

    await cubit.close();
  });

  test('an explicit identifier wins over the RestClient beside it', () async {
    final List<String> paths = <String>[];
    final RestClient rest = RestClient(
      apiUrl: 'https://chat.example.test',
      publishableKey: PublishableKey.parse('dhp_test_0123456789abcdefghijklmn'),
      getAccessToken: () async => 'tok',
      httpClient: MockClient((http.Request request) async {
        paths.add(request.url.path);
        return http.Response(
          '{"success":true,"data":{"sessions":[]}}',
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      }),
    );

    final ChatWidgetCubit cubit = ChatWidgetCubit(
      client: client,
      rest: rest,
      contactProfile: kHostProfile,
      contactIdentifier: record,
    );

    await cubit.connect();
    await settle();

    // Exactly one source is built, and the closure is the more specific
    // instruction — the same `??` the session list and the transcript
    // resolve with, spelled the same way one line apart. The client is still
    // used for the LIST; what it is not used for is this.
    expect(sent, hasLength(1));
    expect(
      paths.where((String p) => p.endsWith('/identify')),
      isEmpty,
    );

    await cubit.close();
  });
}
