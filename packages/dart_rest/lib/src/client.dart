/// The HTTP layer: one place that knows the base path, the two credentials,
/// and how a failure is shaped.
///
/// This package exists because `dhaam_chat` deliberately does not do HTTP. It
/// owns the WebSocket protocol and carries one runtime dependency; the REST
/// seam lives here, which is what lets that package hold its zero-HTTP
/// boundary.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey, TokenProvider;
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart' show MediaType;

import 'errors.dart';

/// Every route on chat-service is mounted under this prefix (its `server.ts`),
/// the same way `dhaam_chat`'s WebSocket sits at a fixed path.
///
/// The OpenAPI `servers` block once resolved to `{apiUrl}/v1`, which is not a
/// path chat-service serves — so every generated client, and this adapter,
/// would have requested a 404. Corrected in the spec; encoded here so a caller
/// only ever states an ORIGIN, never a path.
const String kRestBasePath = '/chat-services/api/v1';

/// How many times `closeSession`/`reopenSession` retry the post-mutation read
/// — never the mutation itself.
///
/// Small on purpose: every attempt costs latency on an action whose
/// server-side effect has already happened.
const int kReadBackAttempts = 3;

/// `limit`'s valid range on `GET /chat/sessions/customer` — server default 5,
/// cap 20 (`chat.validator.ts:52-58`).
const int kSessionSummaryLimitMin = 1;
const int kSessionSummaryLimitMax = 20;

/// One file to upload as a `multipart/form-data` part.
///
/// Bytes rather than a `dart:io` `File` path, deliberately: this package must
/// build on Flutter Web as well as iOS and Android, and `dart:io` does not
/// exist on web. A caller holding a platform file reads its bytes itself —
/// [Uint8List] is the one shape every target platform can produce.
class RestMultipartFile {
  const RestMultipartFile({
    required this.fieldName,
    required this.fileName,
    required this.bytes,
    required this.mimeType,
  });

  /// The multipart field name — `'file'` for `/upload`, the only route that
  /// uses this today. Kept general rather than hardcoded so [RestClient.request]
  /// stays a genuine primitive and not a single-endpoint special case.
  final String fieldName;

  final String fileName;
  final Uint8List bytes;

  /// The part's `Content-Type`.
  ///
  /// Required, with no fallback chain — see [RestClient.request] for why this
  /// costs a dependency and why it is worth one. Must be a parseable media
  /// type such as `'image/png'`; an unparseable value is a caller bug and is
  /// refused with an [ArgumentError] before any request is made.
  final String mimeType;
}

/// The HTTP seam — the Dart mirror of `@dhaam-ccrm/rest`'s `RestClient`.
///
/// One instance per app process, held for the life of the session and shared
/// with everything that needs it. [close] releases the underlying
/// [http.Client] when this instance owns one.
///
/// ── Auth types are reused, not reinvented ─────────────────────────────────
///
/// [PublishableKey] is `dhaam_chat`'s, never a raw [String]: its own reasoning
/// applies here unchanged — a caller cannot supply a secret key even
/// deliberately, because there is no cast from [String] to [PublishableKey].
/// The token source is `dhaam_chat`'s own [TokenProvider] typedef, not a
/// second, incompatible callback shape. That is what makes it possible to
/// build ONE [TokenProvider] and hand it to both a `ChatClient` and a
/// [RestClient] — the "one token source" property that would be lost if this
/// package declared parallel auth types.
///
/// ── Every request carries a fresh token ───────────────────────────────────
///
/// The token provider is invoked on every call to [request] and never cached
/// between calls, so a token refreshed mid-session is picked up without
/// rebuilding this client.
class RestClient {
  /// Throws [ArgumentError] if [apiUrl] is empty once its trailing slashes are
  /// trimmed.
  ///
  /// ── Deliberately one notch stricter than TS ─────────────────────────────
  ///
  /// `client.ts` checks emptiness BEFORE trimming, which lets an `apiUrl` of
  /// exactly `"/"` pass its truthy check and then trim to `""` — a config
  /// mistake that goes on to build `"/chat-services/api/v1/…"` and hit
  /// whatever origin the app happens to be served from. Checking after closes
  /// that one gap (contract §5.5). Called out here so it is not mistaken for
  /// an oversight if a test written against TS's exact ordering does not port.
  ///
  /// Two of TS's other constructor guards have NO Dart equivalent to write, as
  /// the type system already makes their state unconstructible: a falsy
  /// `publishableKey` cannot exist once the parameter is [PublishableKey], and
  /// there is no "is `fetch` available on this runtime" question to ask
  /// because [http.Client] always constructs.
  ///
  /// [httpClient] is the test seam, identical in shape to `fetchRemoteConfig`'s
  /// `client` parameter in `packages/flutter`: omit it and this instance owns
  /// and eventually [close]s a fresh [http.Client]; supply one (typically
  /// `package:http/testing.dart`'s `MockClient`) and this instance never
  /// closes it.
  RestClient({
    required String apiUrl,
    required PublishableKey publishableKey,
    required TokenProvider getAccessToken,
    http.Client? httpClient,
  })  : _apiUrl = _normalizeApiUrl(apiUrl),
        _publishableKey = publishableKey,
        _getAccessToken = getAccessToken,
        _httpClient = httpClient ?? http.Client(),
        _ownsHttpClient = httpClient == null;

  final String _apiUrl;
  final PublishableKey _publishableKey;
  final TokenProvider _getAccessToken;
  final http.Client _httpClient;
  final bool _ownsHttpClient;

  /// Trailing slashes are trimmed here rather than documented as the caller's
  /// problem: `'$origin/' + '/chat-services/…'` yields a double slash, which
  /// some proxies 404 and others silently normalize — a difference that shows
  /// up in exactly one deployment.
  static String _normalizeApiUrl(String apiUrl) {
    final String trimmed = apiUrl.replaceAll(RegExp(r'/+$'), '');
    if (trimmed.isEmpty) {
      // No part of the value is echoed: an apiUrl is not a credential, but the
      // rule that error text never carries input is worth keeping absolute.
      throw ArgumentError.value(
        null,
        'apiUrl',
        'must not be empty once trailing slashes are trimmed',
      );
    }
    return trimmed;
  }

  /// Releases the owned [http.Client].
  ///
  /// A no-op when an `httpClient` was supplied at construction — this instance
  /// never closes a client it does not own, because the caller may still be
  /// using it.
  void close() {
    if (_ownsHttpClient) _httpClient.close();
  }

  /// Issues one request under [kRestBasePath] and returns the DECODED JSON
  /// body — `null` for a `204`, otherwise whatever `jsonDecode` produces.
  ///
  /// ── Why this returns `Object?` and not a generic `T` ──────────────────
  ///
  /// TS's `request<T>` returns `Promise<T>` via an unchecked cast, because
  /// there is no way to verify the body actually IS `T` at the call site — the
  /// type parameter is a promise the caller makes to itself. Every typed
  /// method built on this one decodes the result through the defensive field
  /// readers in `internal/json_reading.dart`, so nothing here ever trusts an
  /// unchecked cast, and a generic `T` would be a cast with extra syntax.
  ///
  /// ── The envelope is NOT unwrapped here ────────────────────────────────
  ///
  /// This never throws for a malformed 2xx body. That is each typed method's
  /// job, because only the typed method knows what shape its own route
  /// promises — and because `/tokens`, `/health*`, `/ready` and `/live` serve
  /// no envelope at all. Unwrapping globally would mean carrying a
  /// route-exception list inside the one module whose job is to know no
  /// routes.
  ///
  /// [query] entries whose value is `null` are omitted entirely; a non-null
  /// value is stringified.
  ///
  /// [jsonBody] and [multipart] are mutually exclusive. [jsonBody] is
  /// `jsonEncode`d and sent with `Content-Type: application/json` — set ONLY
  /// when there is a body. [multipart] is sent as `multipart/form-data` with
  /// the boundary `Content-Type` left to [http.MultipartRequest]; setting that
  /// header by hand produces a body the server cannot parse.
  ///
  /// Throws:
  ///  * whatever the token provider throws, unwrapped — before any network
  ///    activity, see below;
  ///  * [ArgumentError] if [multipart]'s `mimeType` is not a parseable media
  ///    type — also before any network activity;
  ///  * [RestTransportException] if the request never reached the server;
  ///  * [RestApiException] if the server answered outside `200..299`.
  Future<Object?> request(
    String method,
    String path, {
    Map<String, Object?>? query,
    Object? jsonBody,
    RestMultipartFile? multipart,
  }) async {
    assert(
      jsonBody == null || multipart == null,
      'jsonBody and multipart are mutually exclusive',
    );

    // ── Deliberately OUTSIDE the try below ──────────────────────────────
    //
    // A failing TokenProvider — typically dhaam_chat's own
    // TokenUnavailableError — propagates UNWRAPPED rather than being reshaped
    // into a RestTransportException. That is this package's whole answer to
    // "auth failure, distinguishable from a transport failure": the two demand
    // opposite responses, and a caller that cannot tell "I have no credential"
    // from "the network is down" will retry the first forever.
    //
    // No new exception type was invented for it. `dhaam_chat` already models
    // this exact failure, and reusing the type is what makes the property
    // free. The structural choice mirrors `client.ts`, whose `#authHeaders()`
    // call likewise sits outside the `try` that produces a transport error.
    final String token = await _getAccessToken();

    final http.BaseRequest httpRequest = _buildRequest(
      method: method,
      uri: _buildUri(path, query),
      token: token,
      jsonBody: jsonBody,
      multipart: multipart,
    );

    final http.Response response;
    try {
      response = await http.Response.fromStream(
        await _httpClient.send(httpRequest),
      );
    } catch (cause) {
      // No server verdict — DNS failure, connection refused, TLS error,
      // timeout. The cause is HELD, never interpolated into a message: a
      // lower-level error's own text can embed the request URL.
      throw RestTransportException(cause);
    }

    // Response handling sits outside the try on purpose, so a RestApiException
    // raised below is never caught and re-reported as a transport failure.
    return _readResponse(response);
  }

  Uri _buildUri(String path, Map<String, Object?>? query) {
    final Uri base = Uri.parse('$_apiUrl$kRestBasePath$path');
    if (query == null) return base;

    final Map<String, String> present = <String, String>{
      for (final MapEntry<String, Object?> entry in query.entries)
        // Omitted ENTIRELY when null, matching TS's `value !== undefined`
        // skip. Sending `?before=null` would ask the history route to page
        // from a cursor spelled "null" rather than from the newest page.
        if (entry.value != null) entry.key: entry.value.toString(),
    };

    // Only when there is something to add: `replace(queryParameters: {})`
    // would append a bare `?` to every unparameterized URL.
    return present.isEmpty ? base : base.replace(queryParameters: present);
  }

  http.BaseRequest _buildRequest({
    required String method,
    required Uri uri,
    required String token,
    required Object? jsonBody,
    required RestMultipartFile? multipart,
  }) {
    /// Both credentials, on every request (OpenAPI `securitySchemes`).
    final Map<String, String> headers = <String, String>{
      'Authorization': 'Bearer $token',
      'X-Publishable-Key': _publishableKey.value,
    };

    if (multipart != null) {
      final http.MultipartRequest request = http.MultipartRequest(method, uri)
        ..headers.addAll(headers)
        // Content-Type is deliberately NOT set here — http.MultipartRequest
        // adds it along with the boundary it generates, and a hand-written one
        // produces a body the server cannot parse.
        ..files.add(
          http.MultipartFile.fromBytes(
            multipart.fieldName,
            multipart.bytes,
            filename: multipart.fileName,
            // The reason this package takes `http_parser` as a dependency
            // (contract §5.4): `contentType` is typed MediaType with no String
            // overload, and without it every Dart-originated upload reports as
            // application/octet-stream server-side and degrades to a generic
            // FILE attachment — the exact bug `normalizeMediaType` exists to
            // prevent on the READ side of this same upload.
            contentType: _parseMediaType(multipart.mimeType),
          ),
        );
      return request;
    }

    final http.Request request = http.Request(method, uri)
      ..headers.addAll(headers);
    if (jsonBody != null) {
      // Set ONLY when there is a body. A GET carrying a Content-Type describes
      // a payload it does not have.
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(jsonBody);
    }
    return request;
  }

  /// Parses a caller-supplied MIME type, or refuses before any request runs.
  ///
  /// An unparseable value is a CALLER bug, not a wire condition, so it raises
  /// an [ArgumentError] — Dart's convention for a bad argument, and the same
  /// one this class's constructor already uses — rather than one of this
  /// package's [RestException] leaves, which describe things the server or the
  /// network did.
  ///
  /// Note for the endpoint layer: some platform file pickers return an EMPTY
  /// mime type. Deciding what to send for a file whose type the platform
  /// could not name is an endpoint-level policy question, not a transport one,
  /// so it is deliberately not answered here.
  static MediaType _parseMediaType(String mimeType) {
    try {
      return MediaType.parse(mimeType);
    } on FormatException {
      throw ArgumentError.value(
        mimeType,
        'mimeType',
        'must be a parseable media type, such as image/png',
      );
    }
  }

  Object? _readResponse(http.Response response) {
    final int status = response.statusCode;

    // 204 carries no body by definition; parsing one would be reading a field
    // off nothing.
    if (status == 204) return null;

    final Object? parsed =
        response.body.isEmpty ? null : _safeJsonDecode(response.body);

    if (status >= 200 && status < 300) return parsed;

    final _ServerError? structured = _readErrorBody(parsed);
    throw RestApiException(
      code: structured?.code ?? 'HTTP_$status',
      // Built here from the status alone — NEVER from the body. An error body
      // is attacker-influencable and may echo request detail (§14), and this
      // service's upload route returns the raw caught AWS SDK message on its
      // 500 branch, which can name the bucket, key, region or endpoint.
      // `message` is what host applications pipe into their crash reporter by
      // default, so the server's own text goes on `serverMessage` instead.
      message: 'request failed with status $status',
      status: status,
      // `??` falls through only on null, and `_readErrorBody` keeps ONLY a
      // literal boolean. That is the load-bearing detail: coercing an absent
      // `retryable` to `false` would make this fallback unreachable and report
      // every 500 from the service's global error handler — which emits no
      // `retryable` at all — as permanent, silently disabling retry for
      // exactly the class of failure retry exists for.
      retryable: structured?.retryable ?? status >= 500,
      serverMessage: structured?.message,
    );
  }
}

/// The server's structured failure body, narrowed defensively.
///
/// [retryable] is nullable rather than defaulted, and that nullability is the
/// difference between a caller retrying a 500 and not — see the throw site.
class _ServerError {
  const _ServerError({
    required this.code,
    required this.message,
    required this.retryable,
  });

  final String code;
  final String message;
  final bool? retryable;
}

/// Reads `{error: {code, message, retryable}}`, or `null` if the body is not
/// that shape. This is untrusted input and is narrowed field by field.
_ServerError? _readErrorBody(Object? body) {
  if (body is! Map<String, Object?>) return null;

  final Object? error = body['error'];
  if (error is! Map<String, Object?>) return null;

  final Object? code = error['code'];
  if (code is! String) return null;

  final Object? message = error['message'];
  final Object? retryable = error['retryable'];

  return _ServerError(
    code: code,
    // Falls back to the code so `serverMessage` is never a stringified
    // non-string. Both are server-authored and both stay off `message`.
    message: message is String ? message : code,
    // ONLY the server's own verdict. Anything else — absent, null, the string
    // "true" — leaves the decision to the status-code fallback at the throw
    // site.
    retryable: retryable is bool ? retryable : null,
  );
}

/// `jsonDecode`, but a body that is not JSON becomes `null` rather than a
/// thrown [FormatException].
///
/// A non-JSON error body is routine — a proxy's HTML 502 page, a plain-text
/// gateway message — and on the success path a route that returns something
/// unparseable is a malformed response for the TYPED method to reject with a
/// route name attached, not for the transport to crash on.
Object? _safeJsonDecode(String text) {
  try {
    return jsonDecode(text);
  } on FormatException {
    return null;
  }
}
