/// The session picker and switcher — the Flutter counterpart of
/// `packages/widget/src/ui/session-picker.ts`.
///
/// Two surfaces over one row family: a picker SCREEN (recent conversations
/// plus "start a new conversation") and an in-chat header SWITCHER, so a
/// customer already inside one conversation is never stuck in it with no way
/// back.
///
/// One barrel because these are one module split across files, and because
/// the package barrel takes exactly one export line per slice.
///
/// ── The guest-gating rule lives OUTSIDE this module ─────────────────────
///
/// "A guest gets an empty list" is decided server-side — `listSessions`
/// answers a guest with an ordinary `200 {sessions: []}`, never a 403 — and
/// the client rule is exactly `sessions.length > 0`, applied by whoever
/// decides to mount or reveal a surface. Every widget here renders whatever
/// list it is handed, and an EMPTY one renders an empty-state row rather
/// than becoming a hidden component.
///
/// Nothing in this module attempts a guest heuristic of its own. Deriving
/// "is this a guest" a second time, from anything other than that same
/// count, is precisely the two-sources-of-truth bug that put the pre-chat
/// form on one path and not the other — see `ui/pre_chat/chat_identity.dart`,
/// which is where that question is answered exactly once.
///
/// ── Terminal rows are not disabled ──────────────────────────────────────
///
/// CLOSED/RESOLVED is real information and is shown, through the same status
/// label every other status uses. The control underneath is the same
/// enabled, tappable, focusable button regardless: picking a terminal
/// conversation and typing reactivates it server-side, so rendering it inert
/// would take away a path that works.
///
/// ── Reading order ───────────────────────────────────────────────────────
///
///  * `session_row_description.dart` — the accessible name, built from the
///    summary fields and never from the rendered strings.
///  * `session_row_list.dart` — the shared row family both surfaces build
///    their list out of, so a row can never render two ways.
///  * `session_picker_screen.dart` — surface 1, the standalone screen.
///  * `session_switcher.dart` — surface 2, the header toggle and popover.
///  * `session_list_refresher.dart` — the serialisation that keeps two
///    list fetches from racing each other into one wholesale replace.
library;

export 'session_row_description.dart';
export 'session_row_list.dart';
export 'session_picker_screen.dart';
export 'session_switcher.dart';
