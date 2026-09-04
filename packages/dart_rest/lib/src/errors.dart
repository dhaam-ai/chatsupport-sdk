/// Structured failures for the REST surface — the Dart mirror of
/// `@dhaam-ccrm/rest`'s `errors.ts`.
///
/// The API returns one shape on every failure (`{error: {code, message,
/// retryable}}`, OpenAPI's `Error` schema, reusing the §7.4 `ErrorCode`
/// vocabulary so REST and WebSocket share one taxonomy). This module turns
/// that into typed exceptions rather than letting an `http.Response` escape:
/// a caller cannot branch on a response without re-reading a body this
/// package has already consumed.
///
/// ── Two TS sentinel VALUES became two TYPES here ──────────────────────────
///
/// TS folds four distinct conditions into one `RestApiError` and separates
/// them by the `status` number: a real HTTP status for a server refusal,
/// `200` for "the request succeeded and the BODY is wrong" (`unwrapEnvelope`,
/// every `malformed()` call in `projection.ts`), and `0` for "no request was
/// made at all" — a sentinel `validateSessionSummaryLimit`'s own comment calls
/// "the one exception, by design". Both conventions are deliberate in TS and
/// both require a caller to know that a NUMBER carries meaning beyond its
/// literal HTTP reading.
///
/// [RestMalformedResponseException] and [RestValidationException] make each of
/// those facts a distinct type instead. A caller writing
/// `error is RestValidationException` never has to learn that `0` is special.
/// See the contract doc §5.3.
///
/// ── Why `*Exception` and not `*Error` ─────────────────────────────────────
///
/// TS names these `RestApiError`/`RestTransportError` because `Error` is
/// JavaScript's only base class for the job. Dart draws a real line: [Error]
/// is a programmer mistake (`ArgumentError`, `StateError` — unrecoverable),
/// [Exception] is an expected runtime condition a caller is meant to catch.
/// Every failure raised here is squarely the second kind. `implements
/// Exception` on the sealed base follows Dart's convention and matches what
/// `dhaam_chat` already does uniformly across its own error types, whichever
/// name suffix each happens to carry (contract §5.6).
library;

/// Base of every exception this package throws for a REST call gone wrong.
///
/// Sealed, so a `switch` over it is checked for exhaustiveness at compile
/// time — the same reason `dhaam_chat`'s `ServerFrame` is sealed. A new
/// failure mode cannot be added without every exhaustive handler in every
/// consumer being told about it.
sealed class RestException implements Exception {
  const RestException();

  /// Whether retrying the SAME request could plausibly produce a different
  /// answer.
  ///
  /// Mirrors `isWorthRetrying` from `@dhaam-ccrm/rest`'s `adapters.ts`, but as
  /// a member of the sealed type rather than an `instanceof` chain each caller
  /// maintains separately. TS's helper is a four-branch function that every
  /// new error type has to be added to by hand; here the compiler asks for it,
  /// because a leaf cannot exist without answering.
  bool get retryable;
}

/// The request never produced a server verdict — DNS failure, connection
/// refused, TLS error, timeout, abort. Mirrors `RestTransportError`.
///
/// Kept separate from [RestApiException] because the two demand opposite
/// responses: a 401 means fix the credential, a connection refused means try
/// again later. Collapsing them is how a client ends up either retrying a
/// rejected request forever or giving up on a transient blip.
final class RestTransportException extends RestException {
  const RestTransportException(this.cause);

  /// The underlying platform exception — `http.ClientException`,
  /// `SocketException`, `TimeoutException`.
  ///
  /// Held rather than interpolated into a message, and deliberately absent
  /// from [toString]: a lower-level error's own text can embed the request
  /// URL, and on this service the token has historically travelled in the
  /// query string (§14). Same rule `dhaam_chat`'s [TokenUnavailableError]
  /// applies to its own `cause`. A caller that wants it reads this field
  /// deliberately.
  final Object cause;

  /// Always `true`: no server verdict means nothing has yet ruled out trying
  /// again.
  @override
  bool get retryable => true;

  @override
  String toString() =>
      'RestTransportException: the request did not reach the server';
}

/// A request that reached the server and came back a non-2xx status.
/// Mirrors `RestApiError`'s non-2xx branch.
final class RestApiException extends RestException {
  const RestApiException({
    required this.code,
    required this.message,
    required this.status,
    required this.retryable,
    this.serverMessage,
  });

  /// Branch on THIS, never on [message] or [serverMessage] (§12.6).
  ///
  /// Deliberately a [String] rather than a closed enum of the §7.4 codes: it
  /// is EITHER the server's own `error.code` — which this package must not
  /// assume it has an exhaustive list of, since the service can add one
  /// without an SDK release — or the synthesized `'HTTP_$status'` when the
  /// body carried no structured error at all. An enum here would have to
  /// grow an `unknown` member holding a string, which is the string it
  /// already is (contract §5.6).
  final String code;

  /// Fixed, caller-authored text. NEVER the server's own — see
  /// [serverMessage].
  final String message;

  /// The real HTTP status. Always in `400..599` here — a successful status
  /// with a body that does not match the route's documented shape is a
  /// [RestMalformedResponseException], not this.
  final int status;

  @override
  final bool retryable;

  /// The server's own explanation, verbatim. UNTRUSTED — treat as opaque.
  ///
  /// Never folded into [message], and never into [toString]. This service's
  /// upload route returns the raw caught AWS SDK error text on its 500 branch
  /// (`upload.routes.ts:197-203`), which can name the bucket, key, region or
  /// endpoint — and [message] is what a host app's crash reporter records by
  /// default. Anything a server controls that reaches [message] reaches
  /// Sentry.
  ///
  /// Read it for a diagnostic a human is already looking at. Never render it
  /// to an end user, and never branch on it — branch on [code].
  final String? serverMessage;

  /// Deliberately omits [serverMessage]. See its doc: `toString()` is what
  /// gets logged, which is precisely where the server's text must not go.
  @override
  String toString() =>
      'RestApiException($code, status: $status, retryable: $retryable)';
}

/// The transport succeeded (2xx) but the body did not match the shape the
/// route documents — an unenveloped body, a missing required field, an
/// unrecognized enum value, `rated: true` with no numeric rating.
///
/// Collapses what TS spreads across `unwrapEnvelope`'s throw, every
/// `malformed()` call in `projection.ts`, and the inline `MALFORMED_RESPONSE`
/// throws in `adapters.ts`. All of those are ALREADY one condition in TS
/// (`RestApiError` with `code: 'MALFORMED_RESPONSE'`, `status: 200`); this
/// type gives that convention its own name instead of a magic status value.
final class RestMalformedResponseException extends RestException {
  const RestMalformedResponseException({
    required this.context,
    required this.detail,
  });

  /// Names the route, e.g. `'GET /chat/sessions/{sessionId}/messages'` —
  /// mirrors `unwrapEnvelope`'s `context` parameter.
  ///
  /// ALWAYS a caller-side constant, never response content. Response bodies on
  /// this service carry customer message text and signed attachment URLs
  /// (§14), and echoing one into an exception a host app might log is exactly
  /// the leak `envelope.test.ts`'s "never echoes the response body" case
  /// guards against.
  final String context;

  /// A fixed, human-authored description of what was wrong — a field name, a
  /// category of failure. NEVER the offending value, for the same reason
  /// [context] is never response content, and the same reason
  /// `dhaam_chat`'s `requireEnum` refuses to echo an unknown enum: a rule with
  /// an exception is a rule nobody applies consistently.
  final String detail;

  /// Always `false` — a retry cannot reshape a response body. This is contract
  /// drift between this package and the service and needs a code change.
  @override
  bool get retryable => false;

  @override
  String toString() => 'RestMalformedResponseException: $context — $detail';
}

/// A client-side precondition failed before any request was made — currently
/// only `RestClient.listSessions`'s `limit` range check.
///
/// The whole point of the type is the fact encoded in it: no network activity
/// happened, so nothing was consumed, nothing was mutated, and a retry of the
/// same call with the same arguments will fail identically. TS states that
/// with `status: 0` on an otherwise-ordinary API error; here it is the type.
final class RestValidationException extends RestException {
  const RestValidationException(this.message);

  /// Caller-authored, and safe to show a developer: the only inputs this can
  /// describe are ones the CALLER passed, not anything off the wire.
  final String message;

  @override
  bool get retryable => false;

  @override
  String toString() => 'RestValidationException: $message';
}

/// The mutation behind `RestClient.closeSession`/`reopenSession` was applied,
/// but every read-back attempt failed. Mirrors `RestSessionReadBackError`.
///
/// Retrying the WHOLE action is specifically wrong on receipt of this. The
/// server has already closed or reopened the session, and
/// `chatSessionService.closeSession` is not idempotent: a second POST re-runs
/// the status update, re-marks participants as having left, and emits both a
/// fresh "chat closed" SYSTEM message and a new Kafka domain event. The
/// customer would see duplicates in their own transcript. Only [sessionId] is
/// safe to act on — typically by re-issuing just the `GET …/full` this
/// package could not complete.
///
/// ── The TS structural marker is deliberately NOT carried over ─────────────
///
/// `RestSessionReadBackError` has a `sessionMutationApplied = true` boolean
/// so `@dhaam-ccrm/core` — which depends on NOTHING, including
/// `@dhaam-ccrm/rest` — can recognize the condition without an `instanceof`
/// across an import its own design forbids it from having. Dart has no
/// equivalent zero-dependency layer above this package to protect: every
/// consumer of `dart_rest` already imports it, so `is
/// RestSessionReadBackException` is sufficient — and, unlike a duck-typed
/// boolean, statically checked (contract §5.6).
final class RestSessionReadBackException extends RestException {
  const RestSessionReadBackException({
    required this.sessionId,
    required this.cause,
  });

  /// The session the mutation settled on — the one whose read-back failed.
  ///
  /// Not necessarily the id the caller passed: `reopenSession` may converge
  /// onto a different, already-active session, and the receipt's own id is
  /// what gets read back (`chat.routes.ts:297-308`).
  final String sessionId;

  /// The read-back's own last failure — a [RestException] the retry loop gave
  /// up on. Held rather than interpolated: it may itself carry a
  /// [RestApiException.serverMessage].
  final RestException cause;

  @override
  bool get retryable => false;

  @override
  String toString() => 'RestSessionReadBackException($sessionId): the session '
      'was changed, but the updated session could not be read back';
}
