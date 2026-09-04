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
import '../surfaces/product_surface_slot.dart';
import '../ui/pre_chat/pre_chat.dart';
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
  /// [sessionId] names a conversation the HOST wants this widget to open on.
  ///
  /// It decides two things at once, and they are the same fact: which screen
  /// the panel starts on, and whether the customer is looking at a
  /// conversation from the first frame — see
  /// [ChatWidgetState.conversationOpened]. A host that names one has put a
  /// conversation in front of the customer; one that does not has not, and
  /// the pre-chat gate must not fire at mount for it.
  ///
  /// [initialScreen] still overrides the screen half for a host that wants
  /// to land on Messages, and is what the existing callers pass.
  ChatWidgetCubit({
    required WidgetChatClient client,
    RemoteConfig initialConfig = defaultRemoteConfig,
    ScreenName? initialScreen,
    String? sessionId,
    ChatIdentity identity = ChatIdentity.guest,
    Scheduler scheduler = const SystemScheduler(),
    Duration reconnectInterval = kReconnectInterval,
  })  : _client = client,
        _screens = ChatScreens(
          initial: initialScreen ??
              (sessionId == null
                  ? ScreenName.home
                  : ScreenName.conversation),
        ),
        _scheduler = scheduler,
        _reconnectInterval = reconnectInterval,
        super(
          ChatWidgetState.initial(
            config: initialConfig,
            screen: initialScreen ??
                (sessionId == null
                    ? ScreenName.home
                    : ScreenName.conversation),
            identity: identity,
            // The port of `initialScreenName === 'conversation'`. Landing on
            // the conversation screen IS the customer being put in front of
            // a conversation, however the host spelled it.
            conversationOpened:
                (initialScreen ?? ScreenName.home) == ScreenName.conversation ||
                    sessionId != null,
          ),
        ) {
    _connectionSub = _client.connectionStates.listen(_onConnectionState);
    _messagesSub = _client.messages.listen(_onMessage);
    _sessionsSub = _client.sessions.listen(_onSession);
    _typingSub = _client.typing.listen(_onTyping);
    _reconnectingSub = _client.reconnecting.listen(_onReconnecting);
  }

  final WidgetChatClient _client;
  final ChatScreens _screens;

  /// The ONE slot a product surface can occupy.
  ///
  /// ── This wiring lands once ─────────────────────────────────────────
  ///
  /// The CSAT card, the session picker, the header menu's report form and
  /// the consent/offline surfaces all stand in this same slot. They append
  /// their own methods below and their own facts to [surfaceInputs]; none of
  /// them creates a second slot, re-runs the sync on its own cadence, or
  /// mirrors the occupant into state by hand. A second slot is two surfaces
  /// live at once, which is the state `ProductSurfaceSlot` exists to make
  /// unreachable.
  final ProductSurfaceSlot _surfaces = ProductSurfaceSlot();

  /// The slot, for a screen that needs to cancel or release a surface it
  /// opened. Read-only access to the occupant is
  /// [ChatWidgetState.activeSurface], which is what widgets should build
  /// from — this is for the mutators.
  ProductSurfaceSlot get surfaces => _surfaces;

  /// The claim on the slot held by the new-conversation form, or null when it
  /// is not up.
  ///
  /// Held rather than re-derived because a ticket carries the GENERATION it
  /// was issued for: a form the customer opened, walked away from and opened
  /// again must not be closed by the first one's stale callback. See
  /// [SurfaceTicket].
  SurfaceTicket? _composingTicket;

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

  // ── Surfaces ──────────────────────────────────────────────────────────

  /// Stamps the live slot onto every state this Cubit emits.
  ///
  /// ── Why an override rather than a call at each site ────────────────
  ///
  /// [ChatWidgetState.activeSurface] is a MIRROR of `_surfaces.active`, and a
  /// mirror that can drift is exactly the bug collapsing `composingNew` into
  /// the slot was meant to end. Doing it here means there is no emit that can
  /// forget, and no later node can add one: the invariant holds by
  /// construction rather than by everybody remembering.
  ///
  /// `emit` is `@protected` on `BlocBase` and this is a subclass, which is
  /// what makes overriding it legitimate (checked against bloc 9.2.1's own
  /// source, not assumed). Deduplication still works: `super.emit` compares
  /// the TRANSFORMED value against the current state, so a tick that changes
  /// neither the state nor the slot still emits nothing.
  @override
  void emit(ChatWidgetState state) {
    super.emit(
      state.copyWith(
        activeSurface: _surfaces.active,
        clearActiveSurface: _surfaces.active == null,
      ),
    );
  }

  /// The facts [ProductSurfaceSlot.sync] judges, gathered from their owners.
  ///
  /// Every one is derived where it lives and handed in — never re-derived
  /// here. `isGuest` in particular comes from [ChatWidgetState.isGuest],
  /// which forwards to the single derivation on [ChatIdentity]; asking
  /// "profile == null" again here would be the second answer that put the
  /// form on one path and not the other.
  ///
  /// **Later nodes widen this, they do not replace it.** `shouldCollectOffline`
  /// and `csatCard` are left at their "nothing is due" defaults because the
  /// facts behind them do not exist yet: business hours are the offline
  /// module's and whether a rating is owed is the CSAT machine's. Each adds
  /// its own line here.
  SurfaceSyncInputs surfaceInputs() => SurfaceSyncInputs(
        isGuest: state.isGuest,
        preChatEnabled: state.config.preChatEnabled,
        // Separate from the toggle on purpose: they are two independent
        // console controls, and gating on the toggle alone raised an empty
        // form.
        hasPreChatFields: state.config.preChatFields.isNotEmpty,
        preChatAnswered: state.preChatAnswered,
        conversationOpened: state.conversationOpened,
        hasSession: state.session != null,
        hasMessages: state.messages.isNotEmpty,
      );

  /// Re-derives what belongs in the slot and repaints.
  ///
  /// Called from every tick that changes a fact [surfaceInputs] reads —
  /// session, messages, config — and after anything that changes
  /// `conversationOpened` or `preChatAnswered`. Cheap and idempotent: the
  /// slot only reports a change when the answer actually differs, so a sync
  /// that finds nothing new rebuilds nothing.
  void _syncSurfaces() {
    _surfaces.sync(surfaceInputs());
    // Unconditional: the override above is what carries the slot into state,
    // and `super.emit`'s own equality check is what suppresses a no-op.
    emit(state);
  }

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

  void applyRemoteConfig(RemoteConfig config) {
    emit(state.copyWith(config: config));
    // A publish can turn the merchant's pre-chat questions on, or add the
    // first one to an empty list — both change what belongs in the slot.
    _syncSurfaces();
  }

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
  ///
  /// Takes the surface slot rather than setting a flag — see
  /// [ChatWidgetState.composingNew]. The screen it is pressed FROM is
  /// recorded with the claim, so [cancelNewConversation] can put the customer
  /// back where they were: finishing a detour on the conversation screen
  /// strands them on an empty transcript having pressed Cancel.
  ///
  /// Deliberately does NOT set [ChatWidgetState.conversationOpened]. A form
  /// opened from Home is a detour, not a conversation — and counting it would
  /// arm the pre-chat gate behind the very form that is already asking those
  /// questions.
  ///
  /// Clears any topic left selected from a PREVIOUS compose that never sent,
  /// so returning here does not silently carry a stale chip forward.
  void startNewConversation() {
    _composingTicket =
        _surfaces.open(const ComposingNewSurface(), from: _screens.current);
    _screens.go(ScreenName.conversation);
    emit(
      state.copyWith(
        screen: _screens.current,
        canGoBack: _screens.canGoBack,
        clearSelectedTopic: true,
      ),
    );
  }

  /// Backs out of the new-conversation form, returning the customer to the
  /// screen they opened it from.
  ///
  /// Home → Home, Messages → Messages. Not a plain release: that is right for
  /// a surface whose task COMPLETED, where the conversation is what the
  /// customer just started, and wrong for one they abandoned. Opened from the
  /// conversation itself, [ProductSurfaceSlot.cancel] answers
  /// [SurfaceReleased] instead and the conversation comes back — including
  /// its pre-chat gate, which the re-sync raises.
  void cancelNewConversation() {
    final SurfaceTicket? ticket = _composingTicket;
    if (ticket == null) return;
    _composingTicket = null;
    final SurfaceCancelOutcome outcome =
        _surfaces.cancel(ticket, surfaceInputs());
    if (outcome case SurfaceReturnedToOrigin(:final ScreenName origin)) {
      // Back if we can — this surface's own open pushed that origin — and
      // swap otherwise, covering a stack emptied underneath us.
      if (!_screens.back()) _screens.swap(origin);
    }
    _syncScreen();
  }

  /// Opens a past conversation from a Home/Messages row.
  ///
  /// One of the places the widget deliberately PUTS a conversation on screen,
  /// so it sets [ChatWidgetState.conversationOpened] — this is what arms the
  /// pre-chat gate in front of an empty one. `selectSession` (the session
  /// picker's own entry point, landing later) is the same funnel and must set
  /// it the same way.
  ///
  /// Discards a user-initiated surface on the way in: asking for a DIFFERENT
  /// conversation is one of the two moments that mean "I am done with this",
  /// and no state tick will ever clear one of those. Without it the new
  /// conversation is drawn UNDER a stale form.
  ///
  /// Clears [ChatWidgetState.selectedTopic] — a topic chip belongs to a
  /// prospective NEW conversation and has nothing to do with re-opening one.
  void openConversation(String sessionId) {
    _client.joinSession(sessionId);
    _surfaces.discardUserSurface();
    _composingTicket = null;
    _screens.go(ScreenName.conversation);
    emit(
      state.copyWith(
        screen: _screens.current,
        canGoBack: _screens.canGoBack,
        conversationOpened: true,
        clearSelectedTopic: true,
      ),
    );
    _syncSurfaces();
  }

  /// A Common Questions tap: straight into a conversation carrying that one
  /// question, with no pre-chat form in front of it.
  ///
  /// ── Why the questions are skipped, and why that is not a hole ──────
  ///
  /// This is a customer asking one specific thing, not filling in a form. So
  /// the gate is suppressed for the exchange — via
  /// [ProductSurfaceSlot.beginOpeningLine], because the ack lands with an
  /// empty transcript and that is precisely the window the gate would flash
  /// in — and [ChatWidgetState.preChatAnswered] is deliberately left alone:
  /// they were never asked, so the next form still asks.
  ///
  /// Sends the question's PROMPT, never its label: the label is the chip's
  /// wording and the prompt is what the customer means by pressing it.
  void startCommonQuestion(CommonQuestion question) {
    _surfaces.discardUserSurface();
    _composingTicket = null;
    final OpeningLineLatch latch = _surfaces.beginOpeningLine();
    try {
      _screens.go(ScreenName.conversation);
      emit(
        state.copyWith(
          screen: _screens.current,
          canGoBack: _screens.canGoBack,
          conversationOpened: true,
          clearSelectedTopic: true,
        ),
      );
      _syncSurfaces();
      _client.sendMessage(question.prompt);
    } finally {
      latch.release();
    }
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

  /// The single choke point every navigation goes through.
  ///
  /// ── Where `ChatScreens.onChange` would have been ───────────────────
  ///
  /// The reference hangs [ProductSurfaceSlot.discardUserSurface] off
  /// `screens.onChange`. [ChatScreens] deliberately has no such callback (see
  /// its header: this package's Cubit emits after every call instead), so
  /// this method IS that hook — every `go`, `swap` and `back` in this class
  /// ends here, which is what makes it one place rather than four.
  ///
  /// Leaving the conversation screen means the customer walked away from
  /// whatever surface they had opened. Non-preemption means no state tick
  /// will ever clear it for them — the slot is theirs until they hand it
  /// back — so this is where the hand-back is recognised. Without it the next
  /// conversation they open is drawn UNDER a stale form, and a second Start
  /// on that form mints a conversation nobody asked for.
  ///
  /// The AUTOMATIC surfaces are deliberately left alone: they are re-derived
  /// on the next sync, and a pre-chat gate parked behind Home is exactly what
  /// must still be there when the customer returns to that empty
  /// conversation.
  void _syncScreen() {
    if (_screens.current != ScreenName.conversation) {
      _surfaces.discardUserSurface();
      _composingTicket = null;
    }
    emit(
      state.copyWith(
        screen: _screens.current,
        canGoBack: _screens.canGoBack,
      ),
    );
  }

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
    final SurfaceTicket? ticket = _composingTicket;
    if (ticket != null) {
      // The form's task COMPLETED, so the slot goes back through `release`
      // (which re-runs the sync) rather than `cancel`. The customer stays on
      // the conversation they just started, which is what they asked for.
      _composingTicket = null;
      _surfaces.release(ticket, surfaceInputs());
      emit(state.copyWith(clearSelectedTopic: true));
    }
  }

  // ── Pre-chat ──────────────────────────────────────────────────────────

  /// The STRUCTURED half of a pre-chat send — `{kind, answers}`, exactly the
  /// shape `widget.ts`'s `sendPreChatDetails` puts on the wire.
  ///
  /// It rides on the SAME frame as the prose lines rather than going as a
  /// second message, and that is the whole design: chat-service folds this
  /// into a customer-asserted contact on the session (fill-empty only,
  /// `source: 'pre_chat'`), while the agent reads the lines. One frame means
  /// the two can never describe different answers.
  ///
  /// The full [answers] map, not just the answered subset — the prose is
  /// already the human-readable filter, and the structured copy is the raw
  /// record. Built at both call sites through here so the `kind` string is
  /// written once: a typo in it is not a compile error, it is a contact that
  /// silently never gets created.
  static Map<String, Object?> _preChatMetadata(Map<String, String> answers) =>
      <String, Object?>{'kind': 'pre_chat', 'answers': answers};

  /// The customer answered the standalone gate.
  ///
  /// Relays the answers as the opening MESSAGE — they are content, not
  /// identity: a name typed into a form is a claim about this conversation,
  /// not a verified fact about a person, and nothing here upserts a contact.
  /// An empty [answers] sends nothing at all but still counts as answered,
  /// which is the "asked and declined" case.
  ///
  /// Marks [ChatWidgetState.preChatAnswered] AFTER the send, so a customer
  /// whose message failed and who answers again still carries their details.
  Future<void> submitPreChat(Map<String, String> answers) async {
    final String? details = preChatDetailsMessage(
      fields: preChatFieldsToAsk(
        config: state.config,
        isGuest: state.isGuest,
        alreadyAnswered: state.preChatAnswered,
      ),
      answers: answers,
    );
    if (details != null) {
      _client.sendMessage(details, metadata: _preChatMetadata(answers));
    }
    emit(state.copyWith(preChatAnswered: true, preChatAnswers: answers));
    _syncSurfaces();
  }

  /// The customer declined the standalone gate.
  ///
  /// Counts as answered — the gate does not come back. Offered only when the
  /// merchant made nothing required; see [PreChatGate].
  void skipPreChat() {
    emit(state.copyWith(preChatAnswered: true));
    _syncSurfaces();
  }

  /// Starts a conversation from the new-conversation form.
  ///
  /// [topic] is the chip's LABEL, never its id — the id is a console key and
  /// the label is what a human reads. [answers] is null when no fields were
  /// shown and a (possibly empty) map when they were; only the second counts
  /// as having been asked, which is why [ChatWidgetState.preChatAnswered] is
  /// set on exactly that condition.
  ///
  /// The details go out ahead of the opening line so an agent reads them
  /// first, and the latch holds the pre-chat gate down across the whole
  /// exchange: the first send lands with an empty transcript, which is
  /// precisely the window the gate would otherwise flash in.
  void startConversationFrom({
    required String message,
    String? topic,
    Map<String, String>? answers,
  }) {
    final OpeningLineLatch latch = _surfaces.beginOpeningLine();
    try {
      if (answers != null) {
        final String? details = preChatDetailsMessage(
          fields: preChatFieldsToAsk(
            config: state.config,
            isGuest: state.isGuest,
            alreadyAnswered: state.preChatAnswered,
          ),
          answers: answers,
        );
        if (details != null) {
          _client.sendMessage(details, metadata: _preChatMetadata(answers));
        }
      }
      _client.sendMessage(message);
      emit(
        state.copyWith(
          // Absent stays absent: a customer who was never asked must still be
          // asked by the next form.
          preChatAnswered: answers != null ? true : null,
          preChatAnswers: answers,
          startedTopicLabel: topic,
        ),
      );
      final SurfaceTicket? ticket = _composingTicket;
      if (ticket != null) {
        _composingTicket = null;
        _surfaces.release(ticket, surfaceInputs());
      }
      emit(state.copyWith(clearSelectedTopic: true));
    } finally {
      latch.release();
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
    // A transcript that just stopped being empty closes the pre-chat gate's
    // own precondition — see `SurfaceSyncInputs.hasMessages`.
    _syncSurfaces();
  }

  void _onSession(SessionSnapshot session) {
    emit(state.copyWith(session: session));
    _syncSurfaces();
  }

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
