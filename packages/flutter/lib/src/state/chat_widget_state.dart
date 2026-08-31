/// Everything a screen needs to render, in one immutable snapshot —
/// [ChatWidgetCubit]'s state.
library;

import 'package:dhaam_chat/dhaam_chat.dart';
import 'package:equatable/equatable.dart';

import '../config/remote_config.dart';
import '../nav/chat_screens.dart';
import '../session/chat_session_summary.dart';

class ChatWidgetState extends Equatable {
  const ChatWidgetState({
    required this.connectionState,
    required this.config,
    required this.screen,
    required this.canGoBack,
    required this.composingNew,
    required this.session,
    required this.messages,
    required this.isTyping,
    required this.sessionSummaries,
    required this.unreadCount,
    this.selectedTopic,
  });

  /// Starting point for a fresh [ChatWidgetCubit] — disconnected, the
  /// widget's own defaults, on Home, nothing loaded yet. Never renders a
  /// blank screen while waiting: every field already has a safe value.
  factory ChatWidgetState.initial({
    RemoteConfig config = defaultRemoteConfig,
    ScreenName screen = ScreenName.home,
  }) =>
      ChatWidgetState(
        connectionState: ConnectionState.idle,
        config: config,
        screen: screen,
        canGoBack: false,
        composingNew: false,
        session: null,
        messages: const <ChatMessage>[],
        isTyping: false,
        sessionSummaries: const <ChatSessionSummary>[],
        unreadCount: 0,
      );

  final ConnectionState connectionState;
  final RemoteConfig config;
  final ScreenName screen;
  final bool canGoBack;

  /// Whether [ScreenName.conversation] should render the New Conversation
  /// composer (topic chips + textarea + Start) rather than a transcript.
  ///
  /// ── Why this is not a fourth [ScreenName] ───────────────────────────
  ///
  /// `screens.ts`'s `ScreenName` union has exactly three members — home,
  /// messages, conversation — and this package matches it rather than
  /// inventing a fourth. "New conversation" is a MODE of the conversation
  /// screen, not a separate place in the back stack: the CTA on Home and a
  /// row on Messages both land on `ScreenName.conversation`, differing only
  /// in whether they name a session to join. Set by [ChatWidgetCubit.
  /// startNewConversation], cleared by [ChatWidgetCubit.openConversation]
  /// and the moment a message actually sends.
  final bool composingNew;

  /// The session this client is currently in, or `null` before the first
  /// `connection.ack`/`session.updated` snapshot lands.
  final SessionSnapshot? session;

  /// The live transcript, in ARRIVAL order (a `Map` keyed by id preserves
  /// insertion position even when an entry is later updated in place — see
  /// [ChatWidgetCubit]'s header on why that is enough for this pass, and
  /// what it does not attempt).
  final List<ChatMessage> messages;
  final bool isTyping;

  /// Host-supplied conversation summaries for the Messages/Home screens.
  /// Empty by default — see [ChatSessionSummary]'s header on why this
  /// package cannot populate it itself.
  final List<ChatSessionSummary> sessionSummaries;

  /// Sum of [sessionSummaries]' `unreadCount` — the Messages tab's badge.
  /// `0` whenever no summaries have been supplied, which reads as "no
  /// unread", the same safe default an unread badge should have absent real
  /// data.
  final int unreadCount;

  /// The New Conversation screen's chosen topic chip, or `null` — nothing
  /// picked, which is the default and stays valid: a topic is an optional
  /// refinement on a new conversation, never a requirement to start one.
  ///
  /// Cleared (not carried forward) once a new conversation actually starts
  /// composing again, once its first message sends, or when an existing
  /// conversation is opened instead — see [ChatWidgetCubit.startNewConversation],
  /// [ChatWidgetCubit.sendMessage] and [ChatWidgetCubit.openConversation].
  final ConversationTopic? selectedTopic;

  ChatWidgetState copyWith({
    ConnectionState? connectionState,
    RemoteConfig? config,
    ScreenName? screen,
    bool? canGoBack,
    bool? composingNew,
    SessionSnapshot? session,
    List<ChatMessage>? messages,
    bool? isTyping,
    List<ChatSessionSummary>? sessionSummaries,
    int? unreadCount,
    ConversationTopic? selectedTopic,
    // Unlike every other field here, "clear selectedTopic" IS something a
    // real caller needs (see the field's own doc: three different Cubit
    // methods reset it) — plain `??` cannot express "set this to null", so
    // this is the sentinel wrapper `session`'s own comment says was not yet
    // worth adding, now that there is an actual caller for it.
    bool clearSelectedTopic = false,
  }) {
    return ChatWidgetState(
      connectionState: connectionState ?? this.connectionState,
      config: config ?? this.config,
      screen: screen ?? this.screen,
      canGoBack: canGoBack ?? this.canGoBack,
      composingNew: composingNew ?? this.composingNew,
      // `session` has no way to be reset to null through `??` — not needed
      // yet (nothing in this package clears it) and not worth a sentinel
      // wrapper ahead of an actual caller.
      session: session ?? this.session,
      messages: messages ?? this.messages,
      isTyping: isTyping ?? this.isTyping,
      sessionSummaries: sessionSummaries ?? this.sessionSummaries,
      unreadCount: unreadCount ?? this.unreadCount,
      selectedTopic: clearSelectedTopic ? null : (selectedTopic ?? this.selectedTopic),
    );
  }

  @override
  List<Object?> get props => <Object?>[
        connectionState,
        config,
        screen,
        canGoBack,
        composingNew,
        session,
        messages,
        isTyping,
        sessionSummaries,
        unreadCount,
        selectedTopic,
      ];
}
