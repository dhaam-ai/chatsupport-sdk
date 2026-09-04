/// Reproduces the second and third `describe`s of
/// `packages/widget/test/contact-info.test.ts` — `captureGeolocation` (4
/// cases) and `captureContactInfo` (2 cases).
///
/// Its first `describe`, `fetchIpWatermark` (6 cases), is already reproduced
/// in `bootstrap_test.dart`: T1 landed that function, and the test that pins
/// it belongs next to it rather than duplicated here. Between the two files
/// every case in that TS file has a Dart counterpart.
///
/// ── The one structural difference: geolocation is an INJECTED seam ────────
///
/// TS calls `navigator.geolocation.getCurrentPosition` and its tests stub the
/// `navigator` global. This package is pure Dart with no Flutter and no
/// platform plugins, so there is no global to stub and no plugin to depend
/// on: a probe is passed in, and the real platform implementation belongs to
/// the Flutter layer. Each TS case therefore maps onto the probe rather than
/// onto a stubbed global — "no Geolocation API at all" becomes "no probe
/// supplied", and "passes its timeout to the browser API" becomes "passes its
/// timeout to the probe, and does not race a second timer against it".
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat_rest/src/bootstrap.dart';
import 'package:dhaam_chat_rest/src/media.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

const String _apiUrl = 'https://api.example.com';

http.Response _json(Object? body, [int status = 200]) =>
    http.Response(jsonEncode(body), status);

MockClient _watermark({String ip = '203.0.113.7', String watermark = 'wm'}) =>
    MockClient((http.Request _) async =>
        _json(<String, Object?>{'ip': ip, 'watermark': watermark}));

MockClient get _failingWatermark =>
    MockClient((http.Request _) async => throw const _NetworkDown());

/// Records every contribution in the order it arrived, which is the property
/// under test as much as the contents are.
class _Sink {
  final List<RestContactInfo> calls = <RestContactInfo>[];

  void record(RestContactInfo info) => calls.add(info);

  /// Each call flattened to just the keys it actually carried, so "recorded
  /// nothing beyond userAgent" is assertable as a whole-list equality rather
  /// than as a pile of null checks.
  List<Map<String, Object?>> get present => calls
      .map((RestContactInfo info) => <String, Object?>{
            if (info.userAgent != null) 'userAgent': info.userAgent,
            if (info.ip != null) 'ip': info.ip,
            if (info.ipWatermark != null) 'ipWatermark': info.ipWatermark,
            if (info.geo != null)
              'geo': <String, double>{
                'lat': info.geo!.lat,
                'lng': info.geo!.lng,
              },
          })
      .toList();
}

void main() {
  group('the geolocation seam', () {
    test('records nothing when no probe is supplied at all', () async {
      // The Dart analogue of `navigator.geolocation` being absent — a
      // non-browser embed, or an insecure origin the API is refused on.
      final _Sink sink = _Sink();
      await captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        httpClient: _failingWatermark,
      );

      expect(sink.calls, isEmpty);
    });

    test('records lat/lng on a granted, successful fix', () async {
      final _Sink sink = _Sink();
      await captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        httpClient: _failingWatermark,
        geolocation: (Duration _) async =>
            const RestGeoPosition(lat: 37.7749, lng: -122.4194),
      );

      expect(sink.present, <Map<String, Object?>>[
        <String, Object?>{
          'geo': <String, double>{'lat': 37.7749, 'lng': -122.4194},
        },
      ]);
    });

    test('records nothing when the probe resolves null — permission denied',
        () async {
      // Denied, unavailable, or timed out — every non-success path is the same
      // outcome to this feature: fall back to IP geolocation server-side, and
      // never re-prompt from here.
      final _Sink sink = _Sink();
      await captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        httpClient: _failingWatermark,
        geolocation: (Duration _) async => null,
      );

      expect(sink.calls, isEmpty);
    });

    test('passes its timeout to the probe rather than racing a second timer',
        () async {
      // The platform is the thing that can actually abandon a pending prompt
      // and stop draining the radio. A timer racing it would leave the request
      // running with nothing left to receive its answer.
      final List<Duration> received = <Duration>[];
      final _Sink sink = _Sink();

      await captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        httpClient: _failingWatermark,
        geolocationTimeout: const Duration(milliseconds: 1234),
        geolocation: (Duration timeout) async {
          received.add(timeout);
          return null;
        },
      );

      expect(received, <Duration>[const Duration(milliseconds: 1234)]);
    });

    test('defaults to five seconds, well beyond a REST round trip', () async {
      // A permission prompt and a GPS fix can legitimately take seconds, and
      // the visitor may be reading the prompt — but it must still be bounded.
      expect(kGeolocationTimeout, const Duration(seconds: 5));
      expect(kGeolocationTimeout, greaterThan(kIpWatermarkTimeout));

      final List<Duration> received = <Duration>[];
      final _Sink sink = _Sink();
      await captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        httpClient: _failingWatermark,
        geolocation: (Duration timeout) async {
          received.add(timeout);
          return null;
        },
      );

      expect(received, <Duration>[kGeolocationTimeout]);
    });

    test('does NOT wait out the timeout when the probe answers early',
        () async {
      // Proof that the duration is handed over rather than enforced here: a
      // probe answering immediately under a one-hour budget must not make this
      // call take an hour.
      final _Sink sink = _Sink();
      final Stopwatch elapsed = Stopwatch()..start();

      await captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        httpClient: _failingWatermark,
        geolocationTimeout: const Duration(hours: 1),
        geolocation: (Duration _) async =>
            const RestGeoPosition(lat: 1, lng: 2),
      );

      elapsed.stop();
      expect(elapsed.elapsed, lessThan(const Duration(seconds: 5)));
      expect(sink.calls.single.geo?.lat, 1);
    });

    test('survives a probe that throws instead of honouring its contract',
        () async {
      // A probe is documented to resolve null rather than throw, but it is
      // caller-supplied code calling a platform channel. Letting one escape
      // would break this function's "never throws" contract AND, through
      // Future.wait, discard a perfectly good ip-watermark alongside it.
      final _Sink sink = _Sink();

      await captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        userAgent: 'Mozilla/5.0 TestAgent',
        httpClient: _watermark(),
        geolocation: (Duration _) async => throw const _NetworkDown(),
      );

      expect(sink.present, <Map<String, Object?>>[
        <String, Object?>{'userAgent': 'Mozilla/5.0 TestAgent'},
        <String, Object?>{'ip': '203.0.113.7', 'ipWatermark': 'wm'},
      ]);
    });
  });

  group('captureContactInfo', () {
    test(
        'records userAgent SYNCHRONOUSLY, and ip/watermark/geo as each '
        'resolves', () async {
      final _Sink sink = _Sink();

      // Deliberately not awaited yet. A Dart async function body runs up to
      // its first `await` during the CALL, which is the property the first
      // `connection.hello` depends on: the user agent is already recorded
      // before either async capture has had a chance to settle.
      final Future<void> done = captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        userAgent: 'Mozilla/5.0 TestAgent',
        httpClient: _watermark(),
        geolocation: (Duration _) async =>
            const RestGeoPosition(lat: 1, lng: 2),
      );

      expect(sink.present, <Map<String, Object?>>[
        <String, Object?>{'userAgent': 'Mozilla/5.0 TestAgent'},
      ]);

      await done;

      expect(
          sink.present,
          containsAll(<Map<String, Object?>>[
            <String, Object?>{'ip': '203.0.113.7', 'ipWatermark': 'wm'},
            <String, Object?>{
              'geo': <String, double>{'lat': 1, 'lng': 2},
            },
          ]));
      expect(sink.calls, hasLength(3));
      // And the user agent is still FIRST — the others may land in any order.
      expect(sink.calls.first.userAgent, 'Mozilla/5.0 TestAgent');
    });

    test('records nothing beyond userAgent when both async captures fail',
        () async {
      final _Sink sink = _Sink();
      await captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        userAgent: 'Mozilla/5.0 TestAgent',
        httpClient: _failingWatermark,
        // No probe at all: the analogue of a runtime with no geolocation API.
      );

      expect(sink.present, <Map<String, Object?>>[
        <String, Object?>{'userAgent': 'Mozilla/5.0 TestAgent'},
      ]);
    });

    test('never throws, even when every capture fails at once', () async {
      // A widget that throws during boot takes the host app down with it, and
      // enrichment that failed is "send nothing", not an error.
      final _Sink sink = _Sink();

      await expectLater(
        captureContactInfo(
          sink: sink.record,
          apiUrl: 'not a url at all',
          httpClient: _failingWatermark,
          geolocation: (Duration _) async => throw const _NetworkDown(),
        ),
        completes,
      );

      expect(sink.calls, isEmpty);
    });

    test('treats an absent or empty userAgent as nothing to record', () async {
      // An empty string is not a user agent. Matches TS's own length check
      // rather than recording a field-shaped hole the console would render.
      for (final String? absent in <String?>[null, '']) {
        final _Sink sink = _Sink();
        await captureContactInfo(
          sink: sink.record,
          apiUrl: _apiUrl,
          userAgent: absent,
          httpClient: _failingWatermark,
        );

        expect(sink.calls, isEmpty, reason: 'userAgent ${jsonEncode(absent)}');
      }
    });

    test(
        'a failed ip-watermark does not cost a good geolocation, or vice '
        'versa', () async {
      // Independent of each other: either, both or neither may end up
      // contributing to the session that gets created.
      final _Sink withGeoOnly = _Sink();
      await captureContactInfo(
        sink: withGeoOnly.record,
        apiUrl: _apiUrl,
        httpClient: _failingWatermark,
        geolocation: (Duration _) async =>
            const RestGeoPosition(lat: 1, lng: 2),
      );
      expect(withGeoOnly.present, <Map<String, Object?>>[
        <String, Object?>{
          'geo': <String, double>{'lat': 1, 'lng': 2},
        },
      ]);

      final _Sink withIpOnly = _Sink();
      await captureContactInfo(
        sink: withIpOnly.record,
        apiUrl: _apiUrl,
        httpClient: _watermark(),
        geolocation: (Duration _) async => null,
      );
      expect(withIpOnly.present, <Map<String, Object?>>[
        <String, Object?>{'ip': '203.0.113.7', 'ipWatermark': 'wm'},
      ]);
    });

    test('reports each capture as a PARTIAL record, never a whole snapshot',
        () async {
      // A caller merges these. Handing it a record claiming to be complete —
      // with the fields that had not arrived yet spelled as absent — is how a
      // later hello overwrites an earlier good value with nothing.
      final _Sink sink = _Sink();
      await captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        userAgent: 'UA',
        httpClient: _watermark(),
        geolocation: (Duration _) async =>
            const RestGeoPosition(lat: 1, lng: 2),
      );

      final RestContactInfo ua =
          sink.calls.firstWhere((RestContactInfo i) => i.userAgent != null);
      expect(ua.ip, isNull);
      expect(ua.ipWatermark, isNull);
      expect(ua.geo, isNull);

      final RestContactInfo ip =
          sink.calls.firstWhere((RestContactInfo i) => i.ip != null);
      expect(ip.userAgent, isNull);
      expect(ip.geo, isNull);
    });

    test('does not gate on the slower capture — the caller may connect first',
        () async {
      // The design property that makes "do not await this before connect"
      // safe: the user agent is on the sink long before a probe that takes its
      // time has resolved.
      final Completer<RestGeoPosition?> slow = Completer<RestGeoPosition?>();
      final _Sink sink = _Sink();

      final Future<void> done = captureContactInfo(
        sink: sink.record,
        apiUrl: _apiUrl,
        userAgent: 'UA',
        httpClient: _watermark(),
        geolocation: (Duration _) => slow.future,
      );

      // A caller would call connect() right here, with the future unawaited.
      expect(sink.calls.single.userAgent, 'UA');

      slow.complete(const RestGeoPosition(lat: 9, lng: 9));
      await done;

      expect(sink.calls, hasLength(3));
    });
  });
}

/// Stands in for whatever a platform raises when a request never leaves.
class _NetworkDown implements Exception {
  const _NetworkDown();
}
