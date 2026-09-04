/// The guest-only pre-chat gate: who counts as a guest, which questions they
/// are asked, and the surface that asks them.
///
/// One barrel because these are one module split across files, and because
/// the package barrel takes exactly one export line per slice.
///
/// ── Reading order ──────────────────────────────────────────────────────
///
///  * `chat_identity.dart` — the SINGLE derivation of `isGuest`. Read this
///    first; everything else takes its answer as a parameter.
///  * `pre_chat_fields.dart` — the single gate all three field-bearing
///    surfaces call, and the absent-vs-empty answers rule.
///  * `pre_chat_form.dart` — the shared field block, plus the details
///    message the answers become.
///  * `pre_chat_gate.dart` — the standalone surface, for `PreChatSurface`.
library;

export 'chat_identity.dart';
export 'pre_chat_fields.dart';
export 'pre_chat_form.dart';
export 'pre_chat_gate.dart';
