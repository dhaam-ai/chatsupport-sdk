/// Keeps two session-list fetches from racing each other into one wholesale
/// replace — the Dart counterpart of what `session-list-refresh.test.ts`
/// asserts about the widget's `pastSessions` writer.
///
/// ── The bug this exists to prevent ──────────────────────────────────────
///
/// A session list is a PAGE, not a live projection, and every write of it
/// replaces the previous page entirely. Two concurrent fetches are therefore
/// two writers with no ordering between them: let a panel-open fetch still
/// be in flight when a close-driven one goes out, and the older page can
/// land LAST and put every row back to the status it had before the close.
/// The customer watches a conversation that ended two minutes ago go on
/// reading "With an agent".
///
/// The second half is the opposite mistake. Guarding with a plain "already
/// fetching, do nothing" DROPS the second ask — end a conversation and
/// immediately start another, and the list settles on a page fetched before
/// the new conversation existed. So an ask during a flight is remembered and
/// RE-ISSUED once that flight lands, and a burst of them collapses into one
/// re-issue rather than one per event.
///
/// ── Why here, and not in the adapter ────────────────────────────────────
///
/// `dhaam_chat_rest`'s `listSessions` deliberately does no caching and no
/// in-flight collapsing — every call is its own GET, pinned by a test that
/// four calls produce four requests. That is correct: coalescing depends on
/// the list being replaced WHOLESALE by whoever owns that state, and an
/// adapter that decided it would be taking the decision away from the only
/// layer that can see the writes. This is that layer.
///
/// ── Why a collaborator, and not a method on the Cubit ───────────────────
///
/// `ChatWidgetCubit` has no way to fetch a session list: `WidgetChatClient`
/// is the WebSocket slice and `dhaam_chat` cannot list sessions at all (see
/// `ChatSessionSummary`'s header). The list reaches the Cubit through
/// `updateSessionSummaries`, from a host or an integration layer that owns
/// the REST client. This object sits exactly on that seam — a fetch on one
/// side, that one write on the other — and can be asserted with neither a
/// Cubit nor a network in the room.
library;

import '../../session/chat_session_summary.dart';

/// Produces one page of conversations. One call, one request — see this
/// file's header on why the adapter does not collapse them itself.
typedef SessionListFetch = Future<List<ChatSessionSummary>> Function();

/// Serialises session-list fetches and hands each page to one writer.
///
/// Not a stream and not a state container: it owns the SCHEDULING and
/// nothing else. What a page means, who may see it, and whether an empty one
/// hides a surface are all questions for the layers on either side.
class SessionListRefresher {
  SessionListRefresher({
    required SessionListFetch fetch,
    required void Function(List<ChatSessionSummary> sessions) onSessions,
    void Function(Object error, StackTrace stackTrace)? onError,
  })  : _fetch = fetch,
        _onSessions = onSessions,
        _onError = onError;

  final SessionListFetch _fetch;
  final void Function(List<ChatSessionSummary> sessions) _onSessions;
  final void Function(Object error, StackTrace stackTrace)? _onError;

  Future<void>? _flight;
  bool _queued = false;
  bool _disposed = false;

  /// Whether a fetch is out right now.
  bool get isRefreshing => _flight != null;

  /// Whether an ask arrived during the current flight and is owed a re-issue.
  ///
  /// One slot, not a count: three closes landing while a page is open are
  /// three reasons to refetch and exactly one refetch to make.
  bool get isRefreshQueued => _queued;

  /// Asks for a fresh page.
  ///
  /// Starts a fetch when none is out. When one IS out, records that another
  /// is owed and returns the same future — so an awaiting caller is released
  /// once the page THEIR ask produced has landed, not once the page that
  /// happened to be in flight when they asked did.
  ///
  /// Never throws: a fetch failure reaches `onError` and leaves the previous
  /// page on screen, which is the honest thing to show. A stale list still
  /// describes conversations that exist; an emptied one claims they do not.
  Future<void> refresh() {
    if (_disposed) return Future<void>.value();

    final Future<void>? flight = _flight;
    if (flight != null) {
      _queued = true;
      return flight;
    }
    return _flight = _drain();
  }

  /// Stops this refresher writing anything further.
  ///
  /// An in-flight fetch is not cancellable — `SessionListFetch` is a plain
  /// future and this object did not open the connection — so its answer is
  /// DROPPED on arrival instead. Writing a page into a torn-down state layer
  /// is the failure mode this prevents.
  void dispose() {
    _disposed = true;
    _queued = false;
  }

  Future<void> _drain() async {
    try {
      while (true) {
        // Cleared BEFORE the fetch, not after: an ask that arrives while
        // this very fetch is out must be seen as owed. Clearing afterwards
        // would swallow exactly the asks the loop exists to honour.
        _queued = false;

        List<ChatSessionSummary>? page;
        try {
          page = await _fetch();
        } catch (error, stackTrace) {
          if (_disposed) return;
          _onError?.call(error, stackTrace);
        }

        if (_disposed) return;
        // Outside the catch above on purpose. A throwing writer is a caller
        // bug, and reporting it as `onError` would dress it up as a network
        // failure — the one thing `onError` is read as meaning. It escapes
        // instead, and the `finally` below still frees the flight so a bug
        // in the writer cannot wedge this object shut.
        if (page != null) _onSessions(page);

        if (!_queued) return;
      }
    } finally {
      _flight = null;
      _queued = false;
    }
  }
}
