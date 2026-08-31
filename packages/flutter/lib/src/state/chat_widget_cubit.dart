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

class ChatWidgetCubit extends Cubit<ChatWidgetState> {
  ChatWidgetCubit({
    required WidgetChatClient client,
    RemoteConfig initialConfig = defaultRemoteConfig,
    ScreenName initialScreen = ScreenName.home,
  })  : _client = client,
        _screens = ChatScreens(initial: initialScreen),
        super(ChatWidgetState.initial(config: initialConfig, screen: initialScreen)) {
    _connectionSub = _client.connectionStates.listen(_onConnectionState);
    _messagesSub = _client.messages.listen(_onMessage);
    _sessionsSub = _client.sessions.listen(_onSession);
    _typingSub = _client.typing.listen(_onTyping);
  }

  final WidgetChatClient _client;
  final ChatScreens _screens;

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
  /// [ChatWidgetState.composingNew].
  void startNewConversation() {
    _screens.go(ScreenName.conversation);
    emit(state.copyWith(screen: _screens.current, canGoBack: _screens.canGoBack, composingNew: true));
  }

  /// Opens a past conversation from a Home/Messages row.
  void openConversation(String sessionId) {
    _client.joinSession(sessionId);
    _screens.go(ScreenName.conversation);
    emit(state.copyWith(screen: _screens.current, canGoBack: _screens.canGoBack, composingNew: false));
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
  void sendMessage(String content, {String? replyToMessageId}) {
    _client.sendMessage(content, replyToMessageId: replyToMessageId);
    if (state.composingNew) emit(state.copyWith(composingNew: false));
  }

  void markRead({String? upToMessageId}) => _client.markRead(upToMessageId: upToMessageId);

  // ── Inbound ───────────────────────────────────────────────────────────

  void _onConnectionState(ConnectionState connectionState) =>
      emit(state.copyWith(connectionState: connectionState));

  void _onMessage(ChatMessage message) {
    _byId[message.id] = message;
    emit(state.copyWith(messages: _byId.values.toList(growable: false)));
  }

  void _onSession(SessionSnapshot session) => emit(state.copyWith(session: session));

  void _onTyping(TypingEvent event) => emit(state.copyWith(isTyping: event.isTyping));

  @override
  Future<void> close() async {
    await _connectionSub.cancel();
    await _messagesSub.cancel();
    await _sessionsSub.cancel();
    await _typingSub.cancel();
    return super.close();
  }
}
