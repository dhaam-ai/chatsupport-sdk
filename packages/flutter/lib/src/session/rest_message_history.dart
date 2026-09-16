/// The REST-backed half of the transcript seed: page one from `listMessages`,
/// normalised to the order [MessageHistoryFetch] promises.
///
/// Same layering as `rest_session_source.dart`, for the same reason: the seam
/// is function-typed so every test drives it with a closure and no network,
/// and this is the one file in the session module (besides that one) that
/// imports the REST package. See `message_history_source.dart` for why the
/// seam exists at all.
///
/// That keeps all three integration levels available at once, each a step
/// more explicit than the last:
///
///  * `ChatWidgetCubit(rest: rest)` — nothing to write, nothing to get wrong;
///  * `messageHistory: restMessageHistory(rest: rest, limit: 100)` — the same
///    fetch with a different page size;
///  * `messageHistory: (String id) async => myBackend.transcript(id)` — a host
///    that proxies chat through its own service and never touches this file.
library;

import 'package:dhaam_chat_rest/dhaam_chat_rest.dart'
    show
        // `listMessages` is an extension ON `RestClient`, not a member of it:
        // without this in scope the call below does not resolve. Named
        // explicitly rather than importing the barrel wholesale so that stays
        // visible — the same rule `rest_session_source.dart` follows.
        MediaApi,
        RestClient,
        RestMessagePage;

import 'message_history_source.dart';

/// How many messages a transcript seed asks for.
///
/// ── Why the reference's number, and what it costs ───────────────────────
///
/// `DEFAULT_PAGE_SIZE` in `packages/core/src/messages/types.ts` is 20 and
/// this matches it, so the Dart widget and the TS one open a conversation on
/// the same page.
///
/// What that number means here is NOT the same, though, and the difference is
/// worth stating rather than discovering: the reference can page — a scroll
/// handler calls `loadMore` with a backward cursor — and this package cannot.
/// There is no "load older" control anywhere in `lib/`, so 20 is a hard
/// ceiling on how far back a customer can read in a re-opened conversation,
/// with nothing on screen to say anything was left out.
///
/// Left at parity rather than raised on a guess, because "how much of an old
/// conversation should a widget with no scrollback control show" is a product
/// question and not this file's to answer. A host that knows its
/// conversations are long says so explicitly:
/// `messageHistory: restMessageHistory(rest: rest, limit: 100)`.
const int kMessageHistoryPageSize = 20;

/// A [MessageHistoryFetch] over `GET /chat/sessions/{id}/messages`.
///
/// This is what `ChatWidgetCubit(rest: ...)` builds for itself. Call it
/// directly only to change [limit] — everything else about the two paths is
/// identical.
///
/// ── The page is REVERSED, and that is the point of this function ─────────
///
/// `listMessages` returns "newest first, paging backwards" and
/// [MessageHistoryFetch] promises oldest-first, so this reverses. Not
/// cosmetic: the seeder orders by `ChatMessage.seq` (D2, the ordering key),
/// and a history row is allowed to carry none — `projectHistoryRow` keeps
/// `seq` only "when present", because rows predating sequencing legitimately
/// lack it. Rows with no `seq` keep the order they were handed over in, so a
/// page passed straight through would paint exactly those conversations
/// upside down.
///
/// No cursor is sent: the newest page is asked for with no `before` at all
/// (which is what `listMessages` does with a null one), because this package
/// has no way to ask for a second page. See [kMessageHistoryPageSize].
///
/// `hasMore` is DROPPED rather than surfaced, for the same reason: there is
/// no control it could enable and no state it could be stored in. A caller
/// that adds scrollback should widen [MessageHistoryFetch] and carry the
/// route's own flag rather than infer one from the returned list's length.
/// They are different statements, and they disagree in both directions: a
/// page exactly [limit] long with nothing behind it reads as "there is
/// more", and a page can come back SHORTER than the route sent, because
/// `projectHistoryRow` drops a row it cannot even build a placeholder for —
/// one with no id, no `chatSessionId` or no `createdAt`. (A row this SDK
/// merely cannot DECODE is not that case: it becomes a `SYSTEM` placeholder
/// and still occupies its position, so a newer message type costs a notice
/// and never a row.)
///
/// Throws [ArgumentError] for a non-positive [limit], at CONSTRUCTION, before
/// anything is wired up and long before a customer could be shown anything.
/// Deliberately not left to fail inside the fetch: the route answers a bad
/// limit with a 400, which reaches the Cubit's error channel wearing the
/// clothes of a network failure — so a caller bug would be reported as an
/// outage. The same rule `restSessionSource` states for its own range check.
MessageHistoryFetch restMessageHistory({
  required RestClient rest,
  int limit = kMessageHistoryPageSize,
}) {
  if (limit < 1) {
    throw ArgumentError.value(
      limit,
      'limit',
      'must be a positive count — the route answers anything else with a 400, '
          'and routing that through the seed\'s error channel would report a '
          'caller bug as a network failure',
    );
  }

  return (String sessionId) async {
    final RestMessagePage page = await rest.listMessages(
      sessionId: sessionId,
      limit: limit,
    );
    // `toList`, not `page.messages.reversed` handed straight back: a lazy
    // reversed view over a list this function does not own would be iterated
    // by the caller at some later point, and the seeder stores what it is
    // given. One copy of at most [limit] rows, once per conversation opened.
    return page.messages.reversed.toList(growable: false);
  };
}
