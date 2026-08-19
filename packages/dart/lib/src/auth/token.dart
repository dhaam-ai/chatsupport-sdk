/// The `getToken()` contract — PRD §10.3, §10.4, §10.6.
library;

/// Supplies a short-lived, scoped user JWT (§10.4).
///
/// The host app owns this. It calls ITS OWN backend, which holds the secret
/// key and mints the token via `POST /tokens` (§10.3). The secret key never
/// travels to the device and this package never sees one — see
/// `keys.dart` for how that is made structurally impossible.
///
/// ── Why a callback and not a token string ─────────────────────────────────
///
/// §6.1: "core's type signature must make it structurally impossible to pass
/// a static token in place of a callback." In Dart that is free — a `String`
/// is not a `Future<String> Function()` and no cast makes it one. v1 took a
/// static Cognito token by value, which is why recovering from expiry there
/// required a full page reload (§12.6); on a phone the equivalent is asking
/// the user to force-quit the app.
///
/// ── When this package calls it ────────────────────────────────────────────
///
///  * Once before the first connect.
///  * PROACTIVELY ahead of expiry — §10.4 puts the default at 80% of the
///    token's `expiresIn`. Note the SDK is not given `expiresIn` anywhere in
///    the frame protocol; see the note on proactive refresh in README.
///  * REACTIVELY when the server sends `AUTH_EXPIRED` mid-connection, as a
///    fallback for clock skew or unexpectedly short-lived tokens.
///  * On each reconnect attempt, so a resumed connection never presents a
///    token that expired while the socket was down.
///
/// ── What this package does when it fails ──────────────────────────────────
///
/// Throwing, or completing with an empty string, is an auth failure. §10.6
/// escalates to `suspended` after three consecutive ones rather than
/// retry-looping against broken credentials. Implementations should therefore
/// fail fast rather than retrying internally forever — an implementation that
/// never completes is indistinguishable from a hung connection and defeats the
/// escalation.
///
/// Implementations must not log the token they return, and neither does this
/// package.
typedef TokenProvider = Future<String> Function();

/// Raised when [TokenProvider] cannot supply a usable token.
///
/// Carries no token material — not the value, not its length, not a prefix.
/// A length fingerprints a credential and a prefix correlates one, and this
/// exception is exactly the kind a Flutter host hands to a crash reporter.
class TokenUnavailableError implements Exception {
  const TokenUnavailableError(this.reason, {this.cause});

  /// The category of failure. Never token material.
  final String reason;

  /// Whatever the host's [TokenProvider] threw, when it threw.
  ///
  /// NOT included in [toString]: this package cannot know whether the host's
  /// own exception embeds the token it failed to parse. A caller that wants it
  /// can read this field deliberately.
  final Object? cause;

  @override
  String toString() => 'TokenUnavailableError: $reason';
}
