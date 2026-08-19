/// Publishable-key hygiene — PRD §10.1, §10.2, §10.7, §14.
///
/// ── How the secret key is made structurally impossible to ship ────────────
///
/// A mobile binary is not a server. Every string compiled into a Flutter app
/// is extractable from the IPA or APK with `strings`, so a secret key that
/// reaches this package is a secret key on every user's device — and this one
/// mints user tokens. §14 requires that it be "structurally impossible to
/// reference from any browser-targeted package"; the same reasoning applies
/// with more force to a binary the customer cannot revoke.
///
/// Three mechanisms, in increasing order of strength:
///
///  1. [PublishableKey] has ONLY a private constructor. Dart privacy is
///     library-scoped, so `PublishableKey._` is unreachable from anywhere
///     outside this file — including from the rest of this package. The one
///     way to obtain an instance is [PublishableKey.parse], which rejects
///     secret keys before it does anything else.
///
///  2. Every API in this package that needs a key takes a [PublishableKey],
///     never a `String`. A caller therefore cannot supply a secret key even
///     deliberately: there is no cast that produces one. This is strictly
///     stronger than the TypeScript core's branded string, which `as` defeats
///     — Dart has no equivalent escape, because `String` is not a subtype of
///     [PublishableKey] and never can be.
///
///  3. There is no secret-key code path to reach. This package contains no
///     token-minting call, no `POST /tokens` client, and no `Authorization:
///     Bearer dhk_...` header — tokens arrive from the host app through
///     [TokenProvider] and are minted on the customer's own backend (§10.3).
///     Even a leaked secret key has nothing here to use it with.
///
/// What this deliberately does NOT do is quietly ignore a secret key. Someone
/// who pastes one into the publishable slot has already exposed it — it has
/// been in a build system and probably in a source map or a symbol table — so
/// [SecretKeyInClientError] is its own type, distinct from a format error,
/// because the fix is to rotate the credential rather than to correct a
/// character.
///
/// ── No value ever appears in an error, a log line, or toString() ──────────
///
/// These functions run on UNVALIDATED input, which may be a secret key, a user
/// JWT, or a password pasted into the wrong config field. Flutter posts
/// uncaught errors to whatever crash reporter the host installed, so an error
/// carrying its input is an exfiltration path with a stack trace attached.
///
/// The rule is absolute: no substring, no prefix, no length, no hash, no
/// character count. A length fingerprints a credential and a prefix correlates
/// one. Diagnosability comes from naming the CATEGORY of failure precisely.
library;

/// A string proven to be a publishable key (§10.1).
///
/// Obtainable only from [PublishableKey.parse]. See the library comment for
/// why the constructor is private.
final class PublishableKey {
  const PublishableKey._(this.value, this._prefix);

  /// Validates [value] as a publishable key.
  ///
  /// Call this as early as a key enters the process. §10.2 has the server
  /// resolve tenant identity from this key before evaluating anything else, so
  /// a malformed one is an unrecoverable config error — and failing at
  /// construction beats failing after a socket, a token fetch and a round
  /// trip.
  ///
  /// Throws [SecretKeyInClientError] if [value] is a secret key, and
  /// [InvalidPublishableKeyError] if it is otherwise malformed. Neither error
  /// contains any part of [value].
  static PublishableKey parse(String value) {
    // Ordered so the security-relevant answer wins. A secret key is also not a
    // valid publishable key, and reporting it as a mere format error buries
    // the one finding that requires rotating a credential.
    if (_looksLikeSecretKey(value)) throw const SecretKeyInClientError();

    if (value.isEmpty) {
      throw const InvalidPublishableKeyError('it is empty');
    }

    if (value != value.trim()) {
      // Not trimmed-and-accepted: silently repairing input hides the config
      // bug that produced it, and the next value it repairs may be a real key
      // concatenated with something else.
      throw const InvalidPublishableKeyError(
        'it has leading or trailing whitespace',
      );
    }

    final _AcceptedPrefix? prefix = _acceptedPrefixOf(value);
    if (prefix == null) {
      // Names only the CURRENT prefixes. `dhpk_` is tolerated, not
      // recommended, and telling someone to go and obtain one would be advice
      // to adopt a scheme with a removal date. The message is identical for
      // every unrecognised prefix — a distinct one would disclose which scheme
      // the input used.
      throw const InvalidPublishableKeyError(
        'it must start with "$_livePrefix" or "$_testPrefix"',
      );
    }

    final String body = value.substring(prefix.prefix.length);
    if (body.isEmpty) {
      throw const InvalidPublishableKeyError('it has a prefix but no key body');
    }
    if (!_keyBody.hasMatch(body)) {
      throw const InvalidPublishableKeyError(
        'its key body contains characters that are not allowed '
        '(expected letters, digits, "-" and "_")',
      );
    }

    return PublishableKey._(value, prefix);
  }

  /// Non-throwing form of [parse], for callers offering their own diagnostics.
  static PublishableKey? tryParse(String value) {
    try {
      return parse(value);
    } on InvalidPublishableKeyError {
      return null;
    } on SecretKeyInClientError {
      // Deliberately also null rather than rethrown: `tryParse` promises not
      // to throw. A caller who needs to tell a leaked secret from a typo must
      // use `parse`, which is the API that reports it.
      return null;
    }
  }

  /// The key itself, for placing in `connection.hello.d.publishableKey`.
  ///
  /// A publishable key is public by design (§10.1) — it identifies a tenant
  /// and grants nothing. This getter is safe; [toString] is still redacted so
  /// that an accidental interpolation into a log line does not become the
  /// habit that later leaks something that is not public.
  final String value;

  final _AcceptedPrefix _prefix;

  /// Which environment this key addresses (§10.1).
  PublishableKeyEnvironment get environment => _prefix.environment;

  /// Whether this key uses the retired `dhpk_` scheme.
  ///
  /// The key still works — the server accepts it for the length of the
  /// deprecation window. This exists so a host app can surface "you are on a
  /// key format with a removal date" at its own log level, and so the window's
  /// population is observable from the client side.
  bool get isDeprecated => _prefix.deprecated;

  /// Redacted. Never prints the key.
  ///
  /// The environment IS included: it is not a secret, and pointing a live
  /// build at a test tenant is a failure that otherwise goes unnoticed until
  /// someone wonders where the conversations went.
  @override
  String toString() => 'PublishableKey(${environment.name}, redacted)';
}

/// Which environment a publishable key addresses (§10.1).
enum PublishableKeyEnvironment { live, test }

/// Thrown when a value is not a well-formed publishable key.
///
/// Never carries the value.
class InvalidPublishableKeyError implements Exception {
  const InvalidPublishableKeyError(this.reason);

  /// The category of failure. Never any part of the offending input.
  final String reason;

  @override
  String toString() =>
      'InvalidPublishableKeyError: publishableKey is not a valid '
      'publishable key: $reason';
}

/// Thrown when a secret key is supplied where a publishable key belongs.
///
/// Its own type, not a variant of [InvalidPublishableKeyError], because this
/// is not a typo. A secret key that reached client config has been in a build
/// system and is very likely in a shipped binary. The fix is to rotate it.
class SecretKeyInClientError implements Exception {
  const SecretKeyInClientError();

  @override
  String toString() =>
      'SecretKeyInClientError: A secret key was supplied where a publishable '
      'key ($_livePrefix.../$_testPrefix...) is required. Secret keys must '
      'never reach client-side code: they mint user tokens, and every string '
      'in a Flutter binary is extractable from the IPA or APK. Use the '
      'publishable key here, keep the secret key on your own backend '
      '(PRD §10.1), and rotate the exposed secret key now. '
      'The offending value is deliberately omitted from this message.';
}

// ── Prefix table ───────────────────────────────────────────────────────────
//
// Why `dhp_`/`dhk_` and not `pk_`/`sk_`, nor `dhpk_`/`dhsk_`: a bare `pk_`/
// `sk_` scheme is byte-identical to Stripe's, so GitHub's secret scanner
// reports our keys as Stripe keys. Namespacing to `dhpk_`/`dhsk_` fixed the
// symptom and not the cause — Stripe's detector is not anchored, and
// `dhsk_test_X` still CONTAINS `sk_test_X`. `dhp_`/`dhk_` contain neither at
// any offset, so the collision is structural rather than probabilistic.
//
// SPEC DRIFT: PRD §6.1 and §10.1 still document `dhpk_live_`/`dhpk_test_` as
// the current publishable prefixes, and the §6.4 amendment dated 2026-08-18
// argues for them at length. The server now mints only `dhp_`/`dhk_`. An
// implementer working from the PRD builds a validator that accepts `dhpk_`
// and REJECTS every key the system currently issues.

const String _livePrefix = 'dhp_live_';
const String _testPrefix = 'dhp_test_';
const String _deprecatedLivePrefix = 'dhpk_live_';
const String _deprecatedTestPrefix = 'dhpk_test_';

/// Our own secret-key prefix.
const String _ourSecretPrefix = 'dhk_';

/// Secret prefixes that are not the current one but must still be refused as
/// SECRET keys rather than as format errors.
///
/// `sk_` is Stripe's (and several others' by convention). `dhsk_` is our own
/// retired scheme, which the server still accepts and which is still sitting
/// in customer config.
///
/// Note the deliberate asymmetry with `dhpk_`, which IS accepted below. A
/// retired PUBLISHABLE key in client config is where it belongs and merely
/// needs replacing; a retired SECRET key there is exposed no matter which
/// scheme it uses.
const List<String> _foreignSecretPrefixes = <String>['sk_', 'dhsk_'];

class _AcceptedPrefix {
  const _AcceptedPrefix(this.prefix, this.environment, this.deprecated);

  final String prefix;
  final PublishableKeyEnvironment environment;
  final bool deprecated;
}

/// ONE table, read for both acceptance and environment.
///
/// They were two separate `startsWith` chains in the TypeScript, and that is
/// exactly the shape that broke on the last rename: the environment check was
/// `startsWith(LIVE_PREFIX) ? 'live' : 'test'`, so anything the parser
/// accepted that was not byte-identical to `dhp_live_` silently reported
/// itself as a TEST key — a live customer pointed at a test environment, with
/// nothing failing.
const List<_AcceptedPrefix> _acceptedPrefixes = <_AcceptedPrefix>[
  _AcceptedPrefix(_livePrefix, PublishableKeyEnvironment.live, false),
  _AcceptedPrefix(_testPrefix, PublishableKeyEnvironment.test, false),
  _AcceptedPrefix(_deprecatedLivePrefix, PublishableKeyEnvironment.live, true),
  _AcceptedPrefix(_deprecatedTestPrefix, PublishableKeyEnvironment.test, true),
];

_AcceptedPrefix? _acceptedPrefixOf(String value) {
  for (final _AcceptedPrefix entry in _acceptedPrefixes) {
    if (value.startsWith(entry.prefix)) return entry;
  }
  return null;
}

/// URL-safe base64 characters.
///
/// Says nothing about length — §10.1 fixes the prefixes and not the body, so
/// inventing a minimum would reject valid keys the day the issuer changes
/// format. It does exclude `.`, whitespace and quotes, which is what makes it
/// useful: a JWT (dot-separated) or a shell-quoted value pasted into the key
/// field fails here instead of reaching the wire.
final RegExp _keyBody = RegExp(r'^[A-Za-z0-9_-]+$');

/// Whether [value] looks like a secret key.
///
/// Case-insensitive and whitespace-tolerant on purpose. A real key is
/// lowercase and untrimmed input is rejected anyway, but this predicate guards
/// the secret-keys-never-pass invariant, and a guard that can be stepped
/// around by a stray space or a capital letter is not a guard. Over-detecting
/// costs a developer one clear error; under-detecting ships a secret key to
/// every device.
bool _looksLikeSecretKey(String value) {
  final String normalized = value.trim().toLowerCase();
  if (normalized.startsWith(_ourSecretPrefix)) return true;
  // Checked as well as ours, not instead: narrowing to our own current prefix
  // would let a real Stripe secret key — or one of our own retired `dhsk_`
  // keys — fall through to the generic format error, which reads as a typo
  // rather than as the credential incident it is.
  for (final String prefix in _foreignSecretPrefixes) {
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}
