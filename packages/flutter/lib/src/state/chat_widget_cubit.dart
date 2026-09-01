/// Wires a [WidgetChatClient], a [RemoteConfig] and a [ChatScreens] together
/// into one Cubit — the state container every screen in this package reads
/// from and dispatches into.
///
/// ── Why Cubit, not Bloc ──────────────────────────────────────────────────
///
/// Both `dh-customer-app-flutter` and `dh-merchant-app-flutter` standardise
/// on `flutter_bloc` (`^9.1.1` in both) — checked before choosing anything
/// here, per this package's brief. Within that one package, this class is a
/// [Cubit] rather than a [Bloc] for the same reason
/// `dh-customer-app-flutter`'s own `ConnectivityCubit`
/// (`lib/core/network/connectivity_cubit.dart`) is one: the job is mirroring
/// an external source's stream into widget-renderable state via direct
/// method calls, not routing a taxonomy of discrete user-typed events
/// through transformers. `flutter_bloc` is the one pattern; Cubit vs Bloc is
/// a style choice inside it, not a second pattern introduced alongside it.
library;

import 'dart:async';

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../config/remote_config.dart';
import '../nav/chat_screens.dart';
import '../session/chat_session_summary.dart';
import 'chat_widget_state.dart';
import 'widget_chat_client.dart';

/// The longest a recoverable outage is allowed to look stuck.
///
/// `dhaam_chat`'s full-jitter backoff (§8.2) is right about servers and wrong
/// about phones. Its whole job is to protect a recovering server from every
/// client it dropped reconnecting in lockstep, and it does that by growing the
/// delay to a 30-second cap. But the commonest outage a chat widget actually
/// sees is not a server restart — it is one handset losing signal for ninety
/// seconds. That handset is not part of a thundering herd, and making it wait
/// out a 30-second delay after its signal is back is how "it just says
/// Connecting…" gets reported.
///
/// Three seconds is the ceiling this puts on that wait. It does not replace
/// backoff: the client's early attempts are all faster than this (500ms, 1s,
/// 2s), so for the first several failures this timer never wins. It only bites
/// once the curve has climbed past it, which is exactly the regime where one
/// device's retry rate is nobody's problem.
///
/// The same number as `DEFAULT_RECONNECT_INTERVAL_MS` in `@dhaam-ccrm/browser`.
const Duration kReconnectInterval = Duration(seconds: 3);

class ChatWidgetCubit extends Cubit<ChatWidgetState> {
  ChatWidgetCubit({
    required WidgetChatClient client,
    RemoteConfig initialConfig = defaultRemoteConfig,
    ScreenName initialScreen = ScreenName.home,
    Scheduler scheduler = const SystemScheduler(),
    Duration reconnectInterval = kReconnectInterval,
  })  : _client = client,
        _screens = ChatScreens(initial: initialScreen),
        _scheduler = scheduler,
        _reconnectInterval = reconnectInterval,
        super(ChatWidgetState.initial(config: initialConfig, screen: initialScreen)) {
    _connectionSub = _client.connectionStates.listen(_onConnectionState);
    _messagesSub = _client.messages.listen(_onMessage);
    _sessionsSub = _client.sessions.listen(_onSession);
    _typingSub = _client.typing.listen(_onTyping);
    _reconnectingSub = _client.reconnecting.listen(_onReconnecting);
  }

  final WidgetChatClient _client;
  final ChatScreens _screens;

  /// `dhaam_chat`'s own timer seam, reused rather than reinvented: the whole
  /// reconnect cadence below is then drivable from a test with a
  /// `FakeScheduler` and no real clock, exactly as that package's own
  /// connection tests are.
  final Scheduler _scheduler;
  final Duration _reconnectInterval;

  /// The armed cadence tick, or null when there is nothing to cap.
  Cancellable? _reconnectTimer;

  /// Keyed by id so the optimistic-echo-then-confirmed pair `ChatClient`
  /// emits for one send (see its class doc) collapses to one entry rather
  /// than appearing twice. A `Map` preserves insertion order even when an
  /// existing key's value is replaced, which is what keeps the transcript in
  /// arrival order without a separate sort — see [ChatWidgetState.messages].
  ///
  /// What this does NOT do: reorder around gaps or resumed history.
  /// `dhaam_chat` surfaces those as `client.gaps` for a host to refetch over
  /// REST (see its README) — out of scope here for the same reason the
  /// config fetch is the only REST this package adds.
  final Map<String, ChatMessage> _byId = <String, ChatMessage>{};

  late final StreamSubscription<ConnectionState> _connectionSub;
  late final StreamSubscription<ChatMessage> _messagesSub;
  late final StreamSubscription<SessionSnapshot> _sessionsSub;
  late final StreamSubscription<TypingEvent> _typingSub;
  late final StreamSubscription<ReconnectingEvent> _reconnectingSub;

  /// For a screen that needs to call something this Cubit does not wrap
  /// (none does yet) — kept `WidgetChatClient`-typed, not `ChatClient`, so a
  /// caller cannot widen back to the surface this class was built to avoid
  /// depending on.
  WidgetChatClient get client => _client;

  // ── Boot ──────────────────────────────────────────────────────────────

  /// Opens the connection. Not called from the constructor: a Cubit doing
  /// network I/O as a side effect of being constructed is untestable by
  /// construction, and the root widget (which owns this Cubit's lifetime)
  /// is the natural, single place to call this once, from `initState`.
  Future<void> connect() => _client.connect();

  // ── Connectivity ──────────────────────────────────────────────────────

  /// Tells this Cubit what the DEVICE says about the network.
  ///
  /// ── Why the host supplies this rather than this package reading it ────
  ///
  /// Knowing whether a handset has a route means a platform channel —
  /// `connectivity_plus`, in practice — and both sibling apps
  /// (dh-customer-app-flutter, dh-merchant-app-flutter) already depend on it
  /// and already run a `ConnectivityCubit` over it. A library sitting between
  /// those apps and `dhaam_chat` taking the same plugin again would add a
  /// second listener to the same platform stream, a second dependency to
  /// resolve, and a second answer to a question the app has already answered.
  /// So this is a setter, and the host pipes its existing stream into it:
  ///
  /// ```dart
  /// _connectivitySub = connectivity.onConnectivityChanged.listen(
  ///   (List<ConnectivityResult> r) =>
  ///       cubit.setOnline(!r.contains(ConnectivityResult.none)),
  /// );
  /// ```
  ///
  /// Calling it is optional. Left alone the widget behaves as it did before
  /// this existed — the banner still appears on a real outage, off the failed
  /// attempt count, just a few seconds later than a host that wires this up.
  ///
  /// The transition to `true` is not merely recorded: it is the single most
  /// valuable reconnect signal there is, because it means the reason the last
  /// attempts failed is provably gone. It retries immediately rather than
  /// waiting out a backoff computed while the network was still down.
  void setOnline(bool online) {
    if (online == state.online) return;
    emit(state.copyWith(online: online));
    if (online) _client.retryNow();
  }

  /// Abandons an armed reconnect backoff and attempts now.
  ///
  /// Wired to [setOnline] and to the cadence already; this is for an explicit
  /// "Try again" control. A no-op unless the client is waiting out a backoff —
  /// in particular it will NOT revive a suspended or closed client, which §8.1
  /// makes recoverable only by [connect]. That is what [UnavailableView]'s own
  /// Try Again button is for.
  bool retryNow() => _client.retryNow();

  // ── Config ────────────────────────────────────────────────────────────

  void applyRemoteConfig(RemoteConfig config) => emit(state.copyWith(config: config));

  /// Supplies the Messages/Home screens' session list. See
  /// [ChatSessionSummary]'s header on why this Cubit cannot populate this
  /// itself — `dhaam_chat` cannot list sessions, so a host that has its own
  /// backend calls this with what it fetched there.
  void updateSessionSummaries(List<ChatSessionSummary> summaries) {
    final int unread = summaries.fold(0, (int sum, ChatSessionSummary s) => sum + s.unreadCount);
    emit(state.copyWith(sessionSummaries: summaries, unreadCount: unread));
  }

  // ── Navigation ────────────────────────────────────────────────────────

  /// Tab switch — Home or Messages. Not a drill-down: see [ChatScreens.swap].
  void switchTab(ScreenName tab) {
    assert(tab == ScreenName.home || tab == ScreenName.messages, 'not a tab: $tab');
    _screens.swap(tab);
    _syncScreen();
  }

  /// The Home CTA, or the Messages screen's "New conversation" button.
  /// Composes fresh rather than opening a past session — see
  /// [ChatWidgetState.composingNew]. Clears any topic left selected from a
  /// PREVIOUS compose that never sent, so returning to this screen a second
  /// time does not silently carry a stale chip forward as pre-selected.
  void startNewConversation() {
    _screens.go(ScreenName.conversation);
    emit(
      state.copyWith(
        screen: _screens.current,
        canGoBack: _screens.canGoBack,
        composingNew: true,
        clearSelectedTopic: true,
      ),
    );
  }

  /// Opens a past conversation from a Home/Messages row. Clears
  /// [ChatWidgetState.selectedTopic] — a topic chip belongs to a prospective
  /// NEW conversation, and has nothing to do with re-opening an existing one.
  void openConversation(String sessionId) {
    _client.joinSession(sessionId);
    _screens.go(ScreenName.conversation);
    emit(
      state.copyWith(
        screen: _screens.current,
        canGoBack: _screens.canGoBack,
        composingNew: false,
        clearSelectedTopic: true,
      ),
    );
  }

  /// Picks (or, tapped a second time, un-picks) a New Conversation topic
  /// chip — a single-select toggle, matching the `aria-pressed` chip the
  /// console-facing pieces of this feature already use.
  void selectTopic(ConversationTopic topic) {
    final bool alreadySelected = state.selectedTopic == topic;
    emit(
      alreadySelected
          ? state.copyWith(clearSelectedTopic: true)
          : state.copyWith(selectedTopic: topic),
    );
  }

  /// Answers `false` when there is nowhere to go — see [ChatScreens.back]
  /// for what a caller (typically the root widget's system-back handling)
  /// does with that.
  bool back() {
    final bool moved = _screens.back();
    if (moved) _syncScreen();
    return moved;
  }

  void _syncScreen() => emit(state.copyWith(screen: _screens.current, canGoBack: _screens.canGoBack));

  // ── Outbound ──────────────────────────────────────────────────────────

  /// Sends [content]. The optimistic echo arrives through [_onMessage] like
  /// any other — see `ChatClient.sendMessage` on why there is no `Future`
  /// here to await instead.
  ///
  /// Clears [ChatWidgetState.selectedTopic] alongside `composingNew`: a
  /// chosen topic's job was to accompany THIS compose, and once it has sent,
  /// carrying the selection forward would pre-select a chip for whatever the
  /// customer composes next.
  void sendMessage(String content, {String? replyToMessageId}) {
    _client.sendMessage(content, replyToMessageId: replyToMessageId);
    if (state.composingNew) {
      emit(state.copyWith(composingNew: false, clearSelectedTopic: true));
    }
  }

  void markRead({String? upToMessageId}) => _client.markRead(upToMessageId: upToMessageId);

  // ── Inbound ───────────────────────────────────────────────────────────

  void _onConnectionState(ConnectionState connectionState) {
    emit(
      state.copyWith(
        connectionState: connectionState,
        // A completed handshake is the only proof the run of failures is over.
        // Without this reset the banner stays up forever after one bad minute.
        failedAttempts: connectionState == ConnectionState.connected ? 0 : null,
        // The drain happens on this same edge, so the count is read after the
        // client has had it — see ChatClient._onConnectionState.
        queuedCount: _client.queuedCount,
      ),
    );
    _syncReconnectCadence(connectionState);
  }

  void _onReconnecting(ReconnectingEvent event) =>
      emit(state.copyWith(failedAttempts: state.failedAttempts + 1));

  /// Arms the cadence while — and only while — a backoff is counting down.
  ///
  /// ── Why this cannot become a second retry loop ────────────────────────
  ///
  /// A UI layer retrying on its own timer while the client retries on its is
  /// the classic way to hammer a server that is already struggling. This
  /// cannot become that, for a reason in `dhaam_chat` rather than a rule here:
  /// `retryNow()` acts ONLY in [ConnectionState.reconnecting] — a state that
  /// by definition means no socket is open and a timer is counting down —
  /// and returns false everywhere else, including the `connecting` of an
  /// attempt already in flight. So it can never supersede a live attempt, open
  /// a second socket, or shorten anything below the client's own first delay.
  ///
  /// One-shot and re-armed rather than [Scheduler.periodic], because leaving
  /// `connecting` cancels it and re-entering `reconnecting` starts a fresh
  /// three seconds — which is the behaviour wanted, and a periodic timer would
  /// instead fire on whatever phase it happened to be in.
  void _syncReconnectCadence(ConnectionState connectionState) {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    if (connectionState != ConnectionState.reconnecting) return;

    _reconnectTimer = _scheduler.schedule(_reconnectInterval, () {
      _reconnectTimer = null;
      // Re-checked rather than trusted: a tick that fires in the same turn as
      // a transition must not act on the state it was armed for.
      if (_client.connectionState != ConnectionState.reconnecting) return;
      if (_client.retryNow()) return;
      // It refused — the state moved under us between the check and the call.
      // Re-arm rather than going quiet, so a client that lands back in
      // `reconnecting` without a transition event is still capped.
      _syncReconnectCadence(_client.connectionState);
    });
  }

  void _onMessage(ChatMessage message) {
    _byId[message.id] = message;
    emit(
      state.copyWith(
        messages: _byId.values.toList(growable: false),
        // Read on every message rather than tracked separately: a send joins
        // the queue and leaves it without any connection transition, and the
        // client is the one place that knows the real number.
        queuedCount: _client.queuedCount,
      ),
    );
  }

  void _onSession(SessionSnapshot session) => emit(state.copyWith(session: session));

  void _onTyping(TypingEvent event) => emit(state.copyWith(isTyping: event.isTyping));

  @override
  Future<void> close() async {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    await _reconnectingSub.cancel();
    await _connectionSub.cancel();
    await _messagesSub.cancel();
    await _sessionsSub.cancel();
    await _typingSub.cancel();
    return super.close();
  }
}
