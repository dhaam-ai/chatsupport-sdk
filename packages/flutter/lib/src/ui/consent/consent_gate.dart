/// `behaviour.consentRequired` / `behaviour.consentText` — the notice a
/// visitor agrees to before a conversation is stored, and the memory of
/// whether they have.
///
/// ── What this gate does and does not claim ───────────────────────────────
///
/// It gates the COMPOSER, not the widget. A visitor who has not agreed can
/// still open the panel, read the merchant's greeting and see who they would
/// be talking to — none of which stores anything about them. What they cannot
/// do is send, because sending is the act that creates the record the notice
/// is about.
///
/// It is deliberately NOT a claim about lawfulness. The console's own help
/// text is "Required in some jurisdictions before you store a conversation",
/// and what a given jurisdiction requires is the merchant's question, not this
/// package's. This renders the merchant's words and records the answer.
///
/// ── Why the answer is remembered per publishable key ─────────────────────
///
/// A daily customer re-consenting daily reads as broken, and consent fatigue
/// is itself a reason people stop reading notices. The answer therefore lives
/// in `ChatStorage` — the one place this widget remembers a per-visitor
/// decision — keyed per publishable key so two tenants on one device cannot
/// answer for each other.
///
/// A store that is unavailable or full is NOT treated as consent. A failed
/// write means the visitor is asked again next visit — mildly annoying, and
/// the only safe direction to fail in: the alternative is a widget that
/// believes it holds an agreement it never recorded.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show PublishableKey;

import '../../config/remote_config.dart';
import '../../storage/chat_storage.dart';

/// The name this decision is stored under, inside the per-publishable-key
/// namespace [chatStorageKey] builds.
///
/// Matches the reference's `chatsdk:${publishableKey}:consent` exactly, so a
/// merchant reading a web install and an app install side by side sees one
/// key shape rather than two.
const String kConsentStorageName = 'consent';

/// The only value ever written. Matches the reference's `'true'` literal, and
/// the read compares against it rather than testing for mere presence —
/// anything else under this key is somebody else's data, not an agreement.
const String kConsentStoredValue = 'true';

/// Whether the notice is actually in force.
///
/// ── A toggle switched on with empty text is NOT gating ───────────────────
///
/// `consentRequired: true` alone is not enough — the notice also needs
/// something to say. A merchant who switched the toggle on and left the text
/// empty would otherwise disable the composer behind a notice that renders
/// nothing, stranding every visitor with no control to agree with and no
/// explanation on screen. "Nothing to agree to" is not consent withheld.
///
/// Trimmed, because a text field containing two spaces is a merchant who has
/// written nothing, not a merchant who has written whitespace.
bool consentGating(RemoteConfig config) =>
    config.consentRequired && (config.consentText ?? '').trim().isNotEmpty;

/// Whether the composer may be used right now.
///
/// The port of the reference's `agreed: () => !gating || stored`. Stated as a
/// free function over two booleans so the rule is testable without a store, a
/// widget or a config — and so the composer and the notice ask the same
/// question of the same answerer rather than each deciding for itself.
bool consentSatisfied({required bool gating, required bool agreed}) =>
    !gating || agreed;

/// The remembered answer to one tenant's consent notice.
///
/// ── Read ONCE, and closed until the read lands ───────────────────────────
///
/// [ChatStorage] is async on both halves and every consumer of the answer is
/// a synchronous build. So the read is kicked off once, at construction of
/// the thing that owns this, and applied when it lands. Until then the gate is
/// CLOSED, which is the safe direction: a visitor briefly seeing a notice they
/// have already dismissed is a smaller failure than a conversation stored
/// before the answer was known.
class ConsentGate {
  /// A gate whose answer survives the app.
  ///
  /// [publishableKey] is what keeps two tenants on one device apart; it is
  /// spent here, at construction, so no caller downstream can build the key a
  /// second way.
  ConsentGate({
    required ChatStorage storage,
    required PublishableKey publishableKey,
    this.onError,
  })  : _storage = storage,
        _key = chatStorageKey(publishableKey, kConsentStorageName);

  /// A gate that forgets when the widget goes away. The default.
  ///
  /// The visitor's click is honoured for as long as this widget is up and the
  /// notice returns on the next mount — exactly what the reference documents
  /// for a browser with site data blocked, and the same shape
  /// `ChatWidgetState.muted` already has. A host that wants the answer
  /// remembered passes the other constructor with a
  /// [SharedPreferencesChatStorage].
  ///
  /// The key is unqualified here on purpose: a [MemoryChatStorage] built for
  /// this one gate holds nothing else and dies with it, so there is no second
  /// tenant to be kept apart from and no namespace to earn its keep.
  ConsentGate.unremembered({this.onError})
      : _storage = MemoryChatStorage(),
        _key = kConsentStorageName;

  final ChatStorage _storage;
  final String _key;

  /// Where a storage failure is reported. The customer never sees one — a
  /// browser or device that blocks app data is a setting they are entitled
  /// to, not an error to put in front of them.
  final void Function(Object error, StackTrace stackTrace)? onError;

  /// Whether this visitor has already agreed.
  ///
  /// A read that FAILS resolves `false`, which is the same as a first visit:
  /// the notice is shown again. `ChatStorage.read` distinguishes "absent" from
  /// "could not read" precisely so this one caller can decide to collapse them
  /// — the safe direction, since the alternative is treating an unreadable
  /// store as an agreement.
  Future<bool> readAgreed() async {
    try {
      return (await _storage.read(_key)) == kConsentStoredValue;
    } catch (error, stackTrace) {
      onError?.call(error, stackTrace);
      return false;
    }
  }

  /// Records that this visitor agreed.
  ///
  /// ── A failed write does NOT revoke the click ─────────────────────────
  ///
  /// Never rejects, and the caller has already treated the visitor as having
  /// agreed before this runs. Refusing to let somebody chat because their
  /// device blocks app data would punish them for a setting they are entitled
  /// to; the cost of a failed write is only that they are asked again next
  /// visit.
  Future<void> recordAgreed() async {
    try {
      await _storage.write(_key, kConsentStoredValue);
    } catch (error, stackTrace) {
      onError?.call(error, stackTrace);
    }
  }
}
