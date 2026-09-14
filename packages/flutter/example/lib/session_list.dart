/// What this app says about the session list — and nothing else, because
/// there is nothing else left for a host to do.
///
/// ── What used to be here, and why it is gone ─────────────────────────────
///
/// A `toChatSessionSummary` field copy, a `SessionListRefresher` built around
/// `rest.listSessions`, a page-size constant and the four lines joining them
/// to `ChatWidgetCubit.updateSessionSummaries`. Every host integrating the
/// SDK had to write all of that, the integration note told them to copy the
/// mapper out of THIS FILE, and "conversation list not appearing" came back
/// twice more from people who reasonably did not.
///
/// So all of it moved into the package, where it is one constructor argument:
///
/// ```dart
/// ChatWidgetCubit(client: client, rest: rest)
/// ```
///
/// `main.dart` passes exactly that. The fetch, the mapping, the page size,
/// the serialisation of concurrent fetches and the two triggers that ask for
/// a page are all the SDK's now — see `restSessionSource` and the `rest`
/// section of `ChatWidgetCubit`'s constructor doc.
///
/// ── The one fact a developer strip still has to get right ────────────────
///
/// **An empty page is ordinary success, and IS the guest signal.** A guest
/// gets `200 {sessions: []}` — never a 403, never a 404. `listSessions` does
/// not special-case it, deliberately, because turning it into an exception
/// would make "not identified" indistinguishable from "the lookup failed" at
/// exactly the seam that knows they are different.
///
/// So the one function below refuses to call an empty list a failure, which
/// is the whole reason it is a named function with tests rather than a
/// conditional inside a `build`.
library;

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart'
    show kSessionListPageSize;

/// What the developer strip says about the session list, or null when there
/// is nothing worth saying.
///
/// Silent once there are rows: they are on screen and the list is speaking
/// for itself.
///
/// With no rows it says so WITHOUT claiming a fetch has settled, because this
/// app can no longer know that and must not pretend to. The Cubit owns the
/// fetch now and reports a failure to `FlutterError` rather than to a host
/// callback, so "no rows yet" honestly covers all three of not-fetched-yet,
/// fetched-and-empty, and fetched-and-failed — and the line names the first
/// two explicitly so an integrator does not read an empty picker as the bug
/// it looks like.
///
/// [isGuest] changes only the closing clause. An empty page for a guest is
/// the expected answer; an empty page for an identified visitor is also fine,
/// but is worth naming separately so nobody reads it as "the token was
/// ignored".
String? exampleSessionListLine({required bool hasRows, required bool isGuest}) {
  if (hasRows) return null;
  return 'sessions: 0 rows. The SDK fetches GET /chat/sessions/customer '
      '(limit $kSessionListPageSize) itself — this app passes `rest:` and '
      'wires nothing. An empty page is an ordinary 200, not an error, and '
      '${isGuest ? "IS the guest signal" : "for this identified visitor means "
          "the server has no conversations for them yet"}. '
      'A FAILED fetch is reported to FlutterError and leaves the previous '
      'page on screen, so it reads the same here.';
}
