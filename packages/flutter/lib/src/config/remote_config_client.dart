/// Fetching the published config over HTTP, and the mount/offline decisions
/// built on it — the half of `remote-config.ts` that needs a network client,
/// kept separate from `remote_config.dart`'s pure parsing (mirrors how
/// `dhaam_chat` itself keeps `connection/socket.dart`'s transport apart from
/// `protocol/frames.dart`'s parsing).
library;

import 'dart:async';
import 'dart:convert';

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:http/http.dart' as http;

import 'remote_config.dart';

/// Path is fixed by chat-service; only the origin is the caller's to state.
const String _configPath = '/chat-services/api/v1/widget/config';

/// How long [fetchRemoteConfig] waits before giving up and returning `null`.
///
/// Matches `remote-config.ts`'s `CONFIG_TIMEOUT_MS`: short enough that a
/// customer tapping the launcher does not sit looking at a blank panel, long
/// enough that an ordinary cold call lands inside it.
const Duration kConfigFetchTimeout = Duration(seconds: 2);

/// Reads the published config, or returns `null` if it could not be read.
///
/// Never throws: every failure class — network error, a non-2xx status, a
/// body that is not JSON, a timeout — collapses to `null`, because the
/// caller's response to all of them is identical (render its own defaults)
/// and a widget that throws during boot takes the host app down with it.
///
/// [publishableKey] is a [PublishableKey], never a raw [String] — the same
/// boundary `dhaam_chat`'s `ChatClient` draws, and for the same reason (see
/// its README): a secret key must be structurally impossible to handed to a
/// client-side call, and accepting only the already-validated type is what
/// makes that true here too, not just at the socket.
///
/// ── Two things the TypeScript version does that this does not ──────────
///
/// It relies on the BROWSER's own HTTP cache (`cache: 'default'`) to
/// revalidate against chat-service's `max-age=30, stale-while-revalidate=300`
/// — there is no such transparent cache on this side, so every call here is
/// a fresh network request. And it accepts an `AbortSignal` for caller-driven
/// cancellation; `package:http`'s own docs do not state what happens to an
/// in-flight request if a caller-supplied [client] is closed mid-request, so
/// this does not claim that as a cancellation mechanism rather than guessing
/// at undocumented behaviour. [timeout] is what bounds the wait; a caller
/// that wants to give up earlier can simply stop awaiting the returned
/// `Future` and proceed with its own defaults, since nothing here depends on
/// the fetch settling for the rest of the widget to render.
///
/// [client] exists as a seam for tests (`package:http/testing.dart`'s
/// `MockClient`) — see the codebase-design skill's "accept dependencies,
/// don't create them" — and defaults to a fresh, disposable [http.Client]
/// per call otherwise.
Future<RemoteConfig?> fetchRemoteConfig({
  required String apiUrl,
  required PublishableKey publishableKey,
  http.Client? client,
  Duration timeout = kConfigFetchTimeout,
}) async {
  final http.Client httpClient = client ?? http.Client();
  final bool ownsClient = client == null;

  try {
    final Uri uri = Uri.parse(
      '${apiUrl.replaceAll(RegExp(r'/+$'), '')}$_configPath',
    );
    final http.Response response = await httpClient.get(
      uri,
      headers: <String, String>{
        'Accept': 'application/json',
        // The key identifies the tenant and grants nothing on its own
        // (dhaam_chat's PublishableKey doc, §10.1). It is the ONLY
        // credential this request carries, and it goes in a header rather
        // than a query string so it stays out of access logs and any
        // request-logging middleware keyed off the URL.
        'X-Publishable-Key': publishableKey.value,
      },
    ).timeout(timeout);

    if (response.statusCode < 200 || response.statusCode >= 300) return null;

    final Object? body = jsonDecode(response.body);
    return parseRemoteConfig(body);
  } catch (_) {
    // Network error, timeout, malformed JSON — all the same outcome to a
    // caller: there is nothing here to usefully distinguish "server down"
    // from "body was not JSON" from "took too long", and the widget's
    // response is identical either way.
    return null;
  } finally {
    if (ownsClient) httpClient.close();
  }
}

/// Whether the widget should mount a launcher at all.
///
/// Two independent off-switches:
///  * `enabled: false` — the merchant turned the widget off outright.
///  * [OfflineMode.hideWidget] while [RemoteConfig.isOpenNow] is `false` —
///    the merchant chose to disappear outside business hours.
///
/// `isOpenNow == null` never hides anything: it means the tenant does not
/// follow business hours, so there is no "outside" to be outside of.
bool shouldMount(RemoteConfig remote) {
  if (!remote.enabled) return false;
  return !(remote.offlineMode == OfflineMode.hideWidget && remote.isOpenNow == false);
}

/// Whether the out-of-hours form replaces the composer.
///
/// Only [OfflineMode.collectMessage] does. `showMessage` says the team is
/// closed but leaves the composer alone, and `hideWidget` never gets this
/// far — see [shouldMount].
bool shouldCollectOffline(RemoteConfig remote) =>
    remote.isOpenNow == false && remote.offlineMode == OfflineMode.collectMessage;

/// Convenience for the UI layer: is the team closed right now?
bool isOutOfHours(RemoteConfig remote) => remote.isOpenNow == false;
