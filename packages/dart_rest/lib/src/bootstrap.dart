/// The two pre-auth calls that do NOT go through [RestClient].
///
/// Both are made before there is a session, both carry at most a publishable
/// key, and both return `null` on every failure rather than throwing. That
/// last property is what separates them from every other call in this package,
/// and it is not laziness: a widget that throws during boot takes the host
/// app down with it, and the caller's response to "network down", "non-2xx",
/// "timed out" and "body was not JSON" is identical in both cases.
///
/// ── Why these are not methods on RestClient ───────────────────────────────
///
/// [fetchIpWatermark] takes no credential at all: the route authenticates
/// nothing and identifies no tenant — it echoes the caller's OWN observed
/// address back, watermarked. Putting it on [RestClient] would imply an auth
/// relationship that does not exist, and would force a caller to have a token
/// source before it could ask the one question that needs none.
///
/// [fetchWidgetConfig] carries a publishable key and no minted token, which is
/// a DIFFERENT auth model from the two-credential one every [RestClient] route
/// uses — and the envelope/`RestApiException` machinery assumes that model.
/// This is also why neither has a TypeScript sibling in `@dhaam-ccrm/rest`:
/// `fetchRemoteConfig` and `fetchIpWatermark` both live in `packages/widget`
/// there, for exactly this reason (contract §4).
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:http/http.dart' as http;

/// Paths are fixed by chat-service; only the origin is the caller's to state.
const String _ipWatermarkPath = '/chat-services/api/v1/ip-watermark';
const String _widgetConfigPath = '/chat-services/api/v1/widget/config';

/// Bounded the same way the config fetch is: long enough for an ordinary
/// same-datacenter round trip, short enough that a backend hiccup cannot delay
/// this by more than a beat.
///
/// Unlike the config fetch there is no visible UI waiting on this — it purely
/// bounds how long the ip/watermark pair might miss the FIRST
/// `connection.hello`. A value that arrives later simply rides along on the
/// next one.
const Duration kIpWatermarkTimeout = Duration(seconds: 2);

/// Short enough that a customer tapping the launcher does not sit looking at a
/// blank panel, long enough that an ordinary cold call lands inside it.
/// Matches `remote-config.ts`'s `CONFIG_TIMEOUT_MS`.
const Duration kWidgetConfigTimeout = Duration(seconds: 2);

/// The caller's own observed address, watermarked.
class RestIpWatermark {
  const RestIpWatermark({required this.ip, required this.watermark});

  final String ip;
  final String watermark;
}

/// `GET /chat-services/api/v1/ip-watermark`, or `null`.
///
/// NEVER throws. Network failure, a timeout, a non-2xx status and a malformed
/// body all collapse to `null`, because the caller's response to every one of
/// them is identical: send no `ip`/`ipWatermark` on the WebSocket hello.
///
/// Takes no [PublishableKey] and sends no credential of any kind — see this
/// library's header.
///
/// ── The one browser-ism that DOES carry over ──────────────────────────────
///
/// TS passes `cache: 'no-store'` so a watermark is never served from the
/// browser's HTTP cache; the server sends `Cache-Control: no-store` for the
/// same reason. Dart has no transparent cache on iOS or Android — but this
/// package builds for Flutter Web too, where the browser's cache is very much
/// real, so the request header is set rather than assumed unnecessary. A stale
/// watermark is worse than none: it describes an address the caller may no
/// longer be at.
///
/// `credentials: 'omit'` has no Dart equivalent to write. `package:http` sends
/// no cookies unless a caller attaches them, so the property TS has to ask for
/// explicitly is simply the default here.
Future<RestIpWatermark?> fetchIpWatermark({
  required String apiUrl,
  http.Client? httpClient,
  Duration timeout = kIpWatermarkTimeout,
}) async {
  final Object? body = await _getJson(
    url: '${_trimTrailingSlashes(apiUrl)}$_ipWatermarkPath',
    headers: const <String, String>{
      'Accept': 'application/json',
      'Cache-Control': 'no-store',
    },
    httpClient: httpClient,
    timeout: timeout,
  );

  if (body is! Map<String, Object?>) return null;

  // Un-enveloped: this route has never used `{success, data}`. Both fields are
  // required — a watermark with no address, or an address with no watermark,
  // is not half an answer, it is an answer the console cannot render.
  final Object? ip = body['ip'];
  final Object? watermark = body['watermark'];
  if (ip is! String || watermark is! String) return null;

  return RestIpWatermark(ip: ip, watermark: watermark);
}

/// `GET /chat-services/api/v1/widget/config`, or `null`.
///
/// Returns the RAW decoded JSON body — not enveloped, matching
/// [fetchIpWatermark]'s sibling bootstrap shape — or `null` on ANY failure.
/// Never throws, for the same reason.
///
/// ── Deliberately untyped ──────────────────────────────────────────────────
///
/// The MODEL — `RemoteConfig`, its enums, its `Equatable` support — stays in
/// `dhaam_chat_flutter`, which already depends on `package:equatable` for it.
/// Pulling that model down here to type this return would make `equatable` a
/// dependency of every consumer of this package purely to relocate a
/// UI-facing config shape, which is precisely the "why does a mobile SDK's
/// dependency list keep growing" problem `dhaam_chat`'s own pubspec comment
/// exists to head off.
///
/// So this hands back `Object?` and leaves "what this JSON means" to the
/// caller's own parser — the same split [RestClient.request] already draws
/// between "fetch and decode" and "what the typed methods do with the result"
/// (contract §4, decision D3).
///
/// [publishableKey] is a [PublishableKey], never a raw [String], and it is the
/// ONLY credential this request carries. It goes in a header rather than a
/// query string so it stays out of access logs and any request-logging
/// middleware keyed off the URL.
Future<Object?> fetchWidgetConfig({
  required String apiUrl,
  required PublishableKey publishableKey,
  http.Client? httpClient,
  Duration timeout = kWidgetConfigTimeout,
}) =>
    _getJson(
      url: '${_trimTrailingSlashes(apiUrl)}$_widgetConfigPath',
      headers: <String, String>{
        'Accept': 'application/json',
        'X-Publishable-Key': publishableKey.value,
      },
      httpClient: httpClient,
      timeout: timeout,
    );

String _trimTrailingSlashes(String apiUrl) =>
    apiUrl.replaceAll(RegExp(r'/+$'), '');

/// The shared "GET some JSON, or null" body behind both calls above.
///
/// Every failure class is folded into `null` in ONE place, so the two
/// bootstrap calls cannot drift into disagreeing about what counts as a
/// failure.
///
/// [httpClient] is the test seam. As with [RestClient], a client supplied by
/// the caller is never closed here — only one created inside this function is.
Future<Object?> _getJson({
  required String url,
  required Map<String, String> headers,
  required http.Client? httpClient,
  required Duration timeout,
}) async {
  final http.Client client = httpClient ?? http.Client();
  final bool ownsClient = httpClient == null;

  try {
    final http.Response response =
        await client.get(Uri.parse(url), headers: headers).timeout(timeout);

    if (response.statusCode < 200 || response.statusCode >= 300) return null;

    return jsonDecode(response.body);
  } catch (_) {
    // Network error, timeout, malformed JSON, a bad URL — all the same outcome
    // to a caller. There is nothing here worth distinguishing "server down"
    // from "body was not JSON" from "took too long", because the response to
    // each is identical: proceed without this data.
    //
    // Deliberately catching everything, which is a rule this package breaks
    // nowhere else. The justification is the documented contract of both
    // public functions above — "NEVER throws" — and a bare `on Exception`
    // would not deliver it, since a `FormatException` from a malformed URL and
    // an `Error` from a platform channel would both escape.
    return null;
  } finally {
    if (ownsClient) client.close();
  }
}
