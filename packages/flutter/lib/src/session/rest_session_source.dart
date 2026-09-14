/// The REST-backed half of the session list: one page from `listSessions`,
/// mapped to the widget's own summary type, shaped as a [SessionListFetch].
///
/// ── The reported bug this file exists to answer ──────────────────────────
///
/// "Conversation list not appearing", twice, from two different integrators,
/// both passing a valid signed-in customer token. The seam that fills the
/// list was already there — `ChatWidgetCubit`'s `sessionSource` — and it was
/// empty because nobody had written the six lines that fill it. The
/// integration note that told them how did not even compile, because the
/// mapper it referred to lived in the example app and was not exported.
///
/// So the fetch, the map and the page size all live HERE now, and a host that
/// holds a `RestClient` passes it to `ChatWidgetCubit(rest: ...)` and writes
/// nothing at all.
///
/// ── Why this is a function and not a method on the Cubit ─────────────────
///
/// Same rule `transcript_email.dart` states for `restIssueReporter` and
/// `restTranscriptEmailer`: the SEAM stays function-typed so every test can
/// drive it with a closure and no network, and the REST-backed
/// implementation of that seam is a named function beside it. This file is
/// the only one in the session module that imports the REST package, exactly
/// as that one is for the header module.
///
/// That layering is what keeps all three integration levels available at
/// once, each a step more explicit than the last:
///
///  * `ChatWidgetCubit(rest: rest)` — nothing to write, nothing to get wrong;
///  * `sessionSource: restSessionSource(rest: rest, limit: 5)` — the same
///    fetch with a different page size;
///  * `sessionSource: () async => myBackend.conversations()` — a host that
///    proxies chat through its own service and never touches this file.
library;

import 'package:dhaam_chat_rest/dhaam_chat_rest.dart'
    show
        RestChatSessionSummary,
        RestClient,
        // `listSessions` is an extension ON `RestClient`, not a member of it:
        // without this in scope the call below does not resolve. Named
        // explicitly rather than importing the barrel wholesale so that stays
        // visible.
        SessionApi,
        kSessionSummaryLimitMax,
        kSessionSummaryLimitMin;

import '../ui/session_picker/session_list_refresher.dart';
import 'chat_session_summary.dart';

// The mapper's own parameter type, so a host reading a page back out of
// `toChatSessionSummary` does not need a second import to name it. Same rule
// `transcript_email.dart` applies to `RestIssueReport`.
export 'package:dhaam_chat_rest/dhaam_chat_rest.dart'
    show RestChatSessionSummary;

/// How many conversations a session list asks for.
///
/// ── Why the maximum, and not the middle ─────────────────────────────────
///
/// Because this widget cannot page. `MessagesScreen` renders
/// `state.sessionSummaries` in full (filtered by the search box, never
/// paginated) and `HomeScreen` reads the most recent one, so whatever this
/// number is becomes the hard ceiling on the conversations a customer can
/// EVER reach — with no "load more" to get past it and nothing on screen to
/// say anything was left out. The two failure directions are not comparable:
/// too few silently hides a customer's own conversation, too many costs a few
/// kilobytes of JSON on a page fetched when the panel opens and when a row
/// changes.
///
/// Expressed as [kSessionSummaryLimitMax] rather than as `20`, because the
/// intent is literally "as many as the route will give". That also makes an
/// out-of-range default impossible by construction:
/// `listSessions` throws `RestValidationException` outside
/// [kSessionSummaryLimitMin]..[kSessionSummaryLimitMax] BEFORE any request,
/// so a hardcoded number that drifted out of range would surface to the
/// customer as an empty list and to the integrator as a network failure it
/// is not.
const int kSessionListPageSize = kSessionSummaryLimitMax;

/// One REST row, as the widget's own summary type.
///
/// Field-for-field, and that is not a coincidence: [RestChatSessionSummary]
/// and [ChatSessionSummary] both reuse `dhaam_chat`'s `ChatStatus`/`ChatMode`/
/// `HandledBy` rather than each minting an enum, so there is no vocabulary to
/// translate here and no place for a mapping to be subtly wrong.
///
/// The two types exist separately anyway, and correctly: one is what a REST
/// route returned and the other is what a host supplies to the widget. A host
/// that proxies chat through its own backend fills the second from something
/// that is not the first, which is the whole reason `sessionSource` takes a
/// list rather than a client.
///
/// Exported so a host writing its own `sessionSource` over the same routes
/// does not have to copy this out of an example app — which is what the
/// integration note used to tell them to do, in a snippet that could not
/// compile.
ChatSessionSummary toChatSessionSummary(RestChatSessionSummary row) =>
    ChatSessionSummary(
      id: row.id,
      status: row.status,
      mode: row.mode,
      createdAt: row.createdAt,
      closedAt: row.closedAt,
      lastMessageAt: row.lastMessageAt,
      lastMessagePreview: row.lastMessagePreview,
      unreadCount: row.unreadCount,
      handledBy: row.handledBy,
      subject: row.subject,
      topic: row.topic,
    );

/// A [SessionListFetch] over `GET /chat/sessions/customer`.
///
/// This is what `ChatWidgetCubit(rest: ...)` builds for itself. Call it
/// directly only to change [limit] — everything else about the two paths is
/// identical, including the refresher that serialises the fetches and the
/// triggers that ask for them.
///
/// An EMPTY page is ordinary success and is the guest signal: `listSessions`
/// answers a guest with `[]`, never a 403, and turning that into an error
/// would make "not identified" indistinguishable from "the lookup failed" at
/// exactly the seam that knows they are different.
///
/// Throws [ArgumentError] for an out-of-range [limit], at CONSTRUCTION,
/// before anything is wired up and long before a customer could be shown
/// anything. Deliberately not left to fail inside the fetch: a
/// `RestValidationException` raised there reaches `SessionListRefresher`'s
/// `onError`, which is the callback every caller reads as "the network
/// failed" — so a caller bug would arrive wearing a network error's clothes,
/// which is precisely what that typed exception exists to prevent.
SessionListFetch restSessionSource({
  required RestClient rest,
  int limit = kSessionListPageSize,
}) {
  if (limit < kSessionSummaryLimitMin || limit > kSessionSummaryLimitMax) {
    throw ArgumentError.value(
      limit,
      'limit',
      'must be between $kSessionSummaryLimitMin and $kSessionSummaryLimitMax '
          '— listSessions would raise RestValidationException before sending '
          'anything, and routing that through onError would report a caller '
          'bug as a network failure',
    );
  }

  return () async {
    final List<RestChatSessionSummary> page =
        await rest.listSessions(limit: limit);
    // `map`, not a loop with a try: `listSessions` already omits a row it
    // cannot decode, so every row that reaches here is decodable and this
    // mapping cannot fail.
    return page.map(toChatSessionSummary).toList(growable: false);
  };
}
