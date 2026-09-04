/// The one place this widget remembers a per-visitor decision.
///
/// ── Why this exists, and why it exists ONCE ──────────────────────────────
///
/// Two things in this package are a decision the person in front of the
/// screen made and expects to survive: whether they agreed to the merchant's
/// consent notice, and whether they silenced the chime. Both are keyed per
/// publishable key, because two tenants sharing one device must not answer
/// for each other. When the mute state landed there was no store, and
/// `ChatWidgetState.muted` recorded exactly why it did not invent one:
///
///   "the consent gate needs the same store, under the same
///    per-publishable-key rule, and inventing a second one now would leave
///    two answers to 'where does this widget remember a per-visitor
///    decision'."
///
/// This is that store. It is a seam rather than a `SharedPreferences` call
/// scattered through the widgets, for the same reason `AttachmentUploader`,
/// `TranscriptEmailer` and `IssueReporter` are seams: every widget test in
/// this package stays runnable against a plain object, with no plugin, no
/// platform channel and no binding setup.
///
/// ── Two methods, not three ───────────────────────────────────────────────
///
/// Core's own `StorageAdapter` (`packages/core/src/storage/types.ts`) has a
/// third, `remove`, because core's offline queue drains and clears itself.
/// Nothing in this package un-remembers a decision — a visitor who wants to
/// be asked again clears the app's data, exactly as they would clear site
/// data in the browser the reference runs in — so `remove` is not ported. An
/// unused method on an interface is a promise every future implementation
/// has to keep for nobody.
///
/// ── A failed read is "not decided", never an error the customer sees ─────
///
/// Both methods may reject, and both rejections mean something: a read that
/// fails is the same as a first visit, and a write that fails means the
/// answer is honoured for this session and asked again on the next one. That
/// policy is NOT applied here — this file only reports what happened. The
/// consent gate is where the two rejections become behaviour, so the rule
/// lives with the decision it protects instead of being smeared across every
/// implementation. See `ui/consent/consent_gate.dart`.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;
import 'package:shared_preferences/shared_preferences.dart';

/// The namespace every key this widget writes lives under.
///
/// The same literal the reference uses (`chatsdk:` in `ui/consent.ts`, and in
/// core's own keys), so a host inspecting a web install and an app install
/// side by side sees one convention rather than two.
const String kChatStorageNamespace = 'chatsdk';

/// Where one tenant's answer to [name] is recorded.
///
/// ── Keyed per publishable key, and that is the whole point ───────────────
///
/// Two tenants on one device — a merchant testing their own widget beside a
/// customer app, a white-label host embedding two workspaces — must not
/// consent or mute for one another. Building the key here rather than at each
/// call site is what makes that true of every decision this widget stores,
/// instead of the ones somebody remembered to prefix.
///
/// Takes a [PublishableKey] and never a raw [String], matching
/// `remote_config_client.dart`'s own note on the same choice: the key has a
/// parsed type precisely so an unvalidated string cannot stand in for one.
String chatStorageKey(PublishableKey publishableKey, String name) =>
    '$kChatStorageNamespace:${publishableKey.value}:$name';

/// A durable string-keyed store for this widget's per-visitor decisions.
///
/// Async on both halves, because every real backing store is: the reference's
/// own `StorageAdapter` is, `SharedPreferencesAsync` is, and a synchronous
/// interface would oblige every implementation to have already loaded. What
/// that costs is that no synchronous render path may read this directly —
/// which is exactly why the consent gate reads once and caches rather than
/// asking on every build.
abstract interface class ChatStorage {
  /// The value at [key], or null when nothing was stored there.
  ///
  /// Null means ABSENT. A read that could not happen rejects instead, because
  /// "we do not know" and "there is nothing" are different facts, and only a
  /// caller that has decided to may treat the first as the second.
  Future<String?> read(String key);

  /// Writes [value] at [key], replacing whatever was there.
  ///
  /// Resolves only once the value is stored. A rejection means it is not, and
  /// the caller must not act as though the decision was remembered.
  Future<void> write(String key, String value);
}

/// A [ChatStorage] that forgets everything when the widget goes away.
///
/// The default, and not a test-only shim. A host that wires no durable store
/// gets precisely the behaviour the reference documents for a browser with
/// site data blocked: the decision is honoured for as long as the widget is
/// up, and asked again next time. That is the safe direction — the
/// alternative is a widget that believes it holds an agreement it never
/// recorded — and it is the behaviour `ChatWidgetState.muted` already has.
///
/// Also the store every test in this package uses, for the reason the library
/// header gives: no plugin, no channel, no binding setup.
class MemoryChatStorage implements ChatStorage {
  MemoryChatStorage();

  final Map<String, String> _values = <String, String>{};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }
}

/// A [ChatStorage] backed by the platform's own preference store.
///
/// ── Why `SharedPreferencesAsync`, not `SharedPreferences` ────────────────
///
/// The plugin ships both, and its own source marks the older one: "This is a
/// legacy API. For new code, consider [SharedPreferencesAsync] or
/// [SharedPreferencesWithCache]"
/// (`shared_preferences-2.5.3/lib/src/shared_preferences_legacy.dart:18`).
/// The async class is also the honest shape for this seam — [ChatStorage] is
/// async on both halves, so the cached variant would buy a synchronous read
/// that nothing here can use. And the legacy class silently prefixes every
/// key with `flutter.`, which would put a second namespace in front of the
/// one [chatStorageKey] deliberately builds.
///
/// ── Constructed per call, on purpose ─────────────────────────────────────
///
/// `SharedPreferencesAsync`'s constructor throws a `StateError` when no
/// platform implementation is registered, so building one eagerly in this
/// class's own constructor would move that failure to wherever a host
/// happened to construct the adapter — typically `initState`, where it is an
/// app crash rather than a storage miss. Built inside each call, the same
/// failure arrives as a rejected future on the one path that already knows
/// what to do with a store it cannot reach.
///
/// The plugin's class is documented `@immutable` and holds only its options,
/// so there is nothing to reuse by keeping one alive.
class SharedPreferencesChatStorage implements ChatStorage {
  const SharedPreferencesChatStorage();

  @override
  Future<String?> read(String key) => SharedPreferencesAsync().getString(key);

  @override
  Future<void> write(String key, String value) =>
      SharedPreferencesAsync().setString(key, value);
}
