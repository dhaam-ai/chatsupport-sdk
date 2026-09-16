/// The root widget — assembles the three screens behind [ChatWidgetCubit]'s
/// navigation, builds this panel's own [ThemeData] from the published
/// config, and drives system back through [ChatScreens].
///
/// ── Takes a [ChatWidgetCubit], does not build one ────────────────────────
///
/// Constructing a [ChatWidgetCubit] needs a [WidgetChatClient] — which in
/// turn needs a `wsUrl`, a `PublishableKey` and a `getToken` callback, all
/// host-specific. Accepting the already-built Cubit here (rather than those
/// raw pieces) is this package's own "accept dependencies, don't create
/// them" rule applied one level up: the same reasoning [ChatWidgetCubit]
/// itself follows by taking a [WidgetChatClient] rather than constructing a
/// [ChatClient][dhaam_chat.ChatClient] internally.
///
/// [BlocProvider.value] (not [BlocProvider]'s `create` constructor) is used
/// deliberately: `.value` provides an EXISTING instance without taking over
/// its lifecycle (flutter_bloc's own distinction — see
/// pub.dev/documentation/flutter_bloc/latest/flutter_bloc/BlocProvider-class.html).
/// This widget did not create the Cubit, so it does not close it either;
/// that stays the host's responsibility, symmetric with who constructed it.
///
/// ── No [MaterialApp] of its own ──────────────────────────────────────────
///
/// This is a widget a host mounts INSIDE its own app (a pushed route, a
/// modal — the plan does not prescribe one), not a standalone app. Wrapping
/// a second [MaterialApp] here would nest `Navigator`s for no reason; a
/// scoped [Theme] is what makes this subtree render with the merchant's own
/// accent/brightness regardless of the host app's theme, while everything
/// else ([Directionality], the [Navigator] `showModalBottomSheet` needs for
/// the composer's emoji picker) comes from the host's own [MaterialApp]
/// ancestor.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show ConnectionState;
// Flutter's own async.dart (re-exported through material.dart) declares a
// SECOND, unrelated ConnectionState (AsyncSnapshot's none/waiting/active/
// done) — hidden here because this file needs dhaam_chat's §8.1 one and
// never uses Flutter's, so there is nothing lost by resolving the name to
// the one this file actually means.
import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter_bloc/flutter_bloc.dart';

import 'nav/chat_screens.dart';
import 'state/chat_widget_cubit.dart';
import 'state/chat_widget_state.dart';
import 'theme/chat_theme.dart';
import 'ui/chat_bottom_nav.dart';
import 'ui/conversation_screen.dart';
import 'ui/header/header.dart';
import 'ui/home_screen.dart';
import 'ui/messages_screen.dart';
import 'ui/offline_banner.dart';
import 'ui/session_picker/session_picker.dart';
import 'ui/unavailable_view.dart';

/// The [ConnectionState]s that mean the client has stopped on purpose rather
/// than being mid-retry — `packages/dart`'s own §8.1 doc comments for
/// [ConnectionState.suspended] ("auto-retry stopped") and
/// [ConnectionState.closed] ("terminal"), read directly rather than assumed.
/// Everything else — `idle`, `connecting`, `authenticating`, `connected`,
/// `reconnecting` — is either healthy or a blip core is still working
/// through, and showing [UnavailableView] over one of those would tell a
/// customer the service is down while it is coming back. Mirrors
/// `ui/widget.ts`'s identically-purposed `TERMINAL_CONNECTION_STATES`.
const Set<ConnectionState> kTerminalConnectionStates = <ConnectionState>{
  ConnectionState.suspended,
  ConnectionState.closed,
};

class ChatWidget extends StatefulWidget {
  const ChatWidget({
    super.key,
    required this.cubit,
    this.chime,
    this.onClose,
  });

  final ChatWidgetCubit cubit;

  /// The customer asked to leave the panel. Null — the default — draws no
  /// close control at all.
  ///
  /// ── This package never pops a route, and that is the whole point ─────
  ///
  /// The reported gap: "add in home view or message view in SDK to close —
  /// `Navigator.pop`, so it will go back to the original screen." The pop
  /// belongs to the HOST and this callback is where it goes:
  ///
  /// ```dart
  /// ChatWidget(cubit: cubit, onClose: () => Navigator.of(context).pop());
  /// ```
  ///
  /// Calling [Navigator.pop] from inside this widget would be this package
  /// dismissing a route it did not push. It mounts no [MaterialApp] and
  /// therefore no [Navigator] of its own (see this library's header), so the
  /// only navigator in scope is the host's — and this widget may not be on a
  /// pushed route at all: a panel embedded in a page, or shown in a sheet
  /// the host closes its own way, would have some unrelated screen popped
  /// out from under it. The conversation app bar already makes exactly this
  /// refusal one screen in, with `automaticallyImplyLeading: false`.
  ///
  /// ── Optional for the same reason every other seam here is ───────────
  ///
  /// Absent means OFF, not broken — the rule the ⋯ menu applies to an
  /// unbacked row and [ChatWidgetCubit] applies to an unwired
  /// `sessionSource`. A host that mounts this panel as a tab of its own app
  /// has nothing to close and passes nothing, and gets the same two screens
  /// it had before this parameter existed. A control that appeared anyway
  /// and did nothing would be the survey-that-discards-the-answer bug
  /// wearing another face.
  ///
  /// Reaches Home and Messages, and not the conversation screen: those two
  /// are where a customer is between conversations, and the conversation
  /// already has a header with its own controls. Pinned by
  /// `test/ui/close_affordance_test.dart`.
  final VoidCallback? onClose;

  /// The reply chime, or null to build the default one.
  ///
  /// Injectable for the reason every other platform-touching thing in this
  /// package is (`AttachmentPicker`, `ChimePlayer`, `GeolocationProbe`): a
  /// widget that reaches a platform channel directly is a widget whose tests
  /// cannot run in CI. The default player bundles this package's own
  /// `assets/chime.wav` through `audioplayers` — see `chime.dart` on why that
  /// replaced `SystemSound`, which Flutter ignores on Android, iOS and web,
  /// and on how a host supplies its own player instead.
  final Chime? chime;

  @override
  State<ChatWidget> createState() => _ChatWidgetState();
}

class _ChatWidgetState extends State<ChatWidget> {
  late final Chime _chime = widget.chime ?? Chime();

  @override
  void initState() {
    super.initState();
    // Seeds the chime's watermark WITHOUT playing — the counterpart of the
    // reference's `{ immediate: true }` on its own `unreadCount`
    // subscription (widget.ts:2088). Without this first observation the
    // listener below would mistake the first real reply for the initial
    // reading and stay silent for it.
    //
    // `playOnUnreadRise` enforces "strictly on the way up, never on the
    // first observation": the count also FALLS (to zero, when the panel is
    // read), and a restored session's backlog must not greet a returning
    // visitor with a noise about messages they have already read.
    //
    // ── The SAME number the listener reads, and why it has to be ────────
    //
    // `customerVisibleUnreadCount`, not the whole-page `unreadCount` — the
    // two sites are one mechanism. The watermark seeded here is what every
    // later rise is compared against, so a seed taken from the wider count
    // while the listener read the narrower one would compare a real reply
    // against a number it can never exceed and stay silent for it. Pinned
    // by `chime_mount_test.dart`'s "seeds its first silent reading from the
    // VISIBLE count", which fails if only one of the two is narrowed.
    _chime.playOnUnreadRise(
      unread: widget.cubit.state.customerVisibleUnreadCount,
      sound: widget.cubit.state.config.sound,
      muted: widget.cubit.state.muted,
    );
    // Not in the Cubit's own constructor — see ChatWidgetCubit.connect's
    // doc: network I/O as a side effect of construction is untestable by
    // construction, and this widget (which owns nothing about the Cubit's
    // lifetime beyond mounting it) is the single, natural place to call it
    // once.
    widget.cubit.connect();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider<ChatWidgetCubit>.value(
      value: widget.cubit,
      // A Consumer, not a Listener wrapped around a Builder: it carries both
      // halves at one nesting level, so mounting the chime does not re-indent
      // the whole panel.
      // https://pub.dev/documentation/flutter_bloc/latest/flutter_bloc/BlocConsumer-class.html
      child: BlocConsumer<ChatWidgetCubit, ChatWidgetState>(
        // The reply chime — the Flutter counterpart of the reference's
        // `store.select((state) => state.unreadCount, ...)`. A listener
        // rather than anything in `build`, because a chime is an effect of a
        // CHANGE and a rebuild happens for a hundred reasons that are not
        // one. `listenWhen` is the selector; the initial reading is taken in
        // `initState` instead.
        //
        // ── The chime obeys the same rule as the badge ─────────────────
        //
        // The number watched is `customerVisibleUnreadCount`, the same one
        // the Messages tab badge counts — NOT the whole-page
        // `unreadCount`. A conversation the merchant has CLOSED is on none
        // of this widget's surfaces, so an unread rise confined to one
        // moves no badge, shows no row and leads nowhere: a sound for it is
        // a promise the customer can neither explain nor act on, and the
        // sound is the louder half of that promise, not the exempt one.
        // The selector is narrowed WITH the value, deliberately: one
        // number, watched and recorded in the same place, so the watermark
        // cannot drift away from what is being handed over. A selector left
        // on the whole page would record the visible count only on the
        // ticks the page happened to move, stranding the watermark above it
        // and swallowing the next real reply — the same failure the
        // `initState` seed's own note describes, from the other end.
        //
        // The price is named rather than hidden: the exception in
        // [ChatWidgetState.customerVisibleSessions] moves this number too,
        // so joining a conversation that was ALREADY closed brings its
        // unread into the sum and chimes once for a navigation rather than
        // an arrival. Nothing in this package lists a closed conversation
        // to tap, so that needs a host opening one directly; it is the
        // lesser of the two, not a case anybody decided was wanted.
        listenWhen: (ChatWidgetState previous, ChatWidgetState current) =>
            previous.customerVisibleUnreadCount !=
            current.customerVisibleUnreadCount,
        listener: (BuildContext context, ChatWidgetState state) =>
            _chime.playOnUnreadRise(
          unread: state.customerVisibleUnreadCount,
          // BOTH have to agree: `config.sound` is the merchant enabling a
          // chime at all, `muted` is this visitor silencing it. `Chime` is
          // the one place the two are combined, so no caller can satisfy one
          // and forget the other.
          sound: state.config.sound,
          muted: state.muted,
        ),
        builder: (BuildContext context, ChatWidgetState state) {
          final ThemeData theme = chatThemeData(
              state.config, MediaQuery.platformBrightnessOf(context));

          return Theme(
            data: theme,
            child: PopScope(
              // Blocks the system pop only while ChatScreens has somewhere
              // to go back TO; otherwise a back gesture closes the panel
              // itself, which is the host's concern (however it mounted
              // this widget), not this widget's to prevent.
              // https://api.flutter.dev/flutter/widgets/PopScope-class.html
              canPop: !state.canGoBack,
              onPopInvokedWithResult: (bool didPop, Object? result) {
                if (!didPop) widget.cubit.back();
              },
              child: Scaffold(
                // The conversation gets a header; Home and Messages do not.
                // They are tabs, not drill-downs, and Home already greets the
                // customer via its own HeroHeader — a second, generic bar
                // above it would be a redundant header, not a helpful one.
                //
                // ── The gate is the SCREEN, not the back history ──────────
                //
                // This used to read `state.canGoBack`, and the two are not the
                // same fact. `canGoBack` is `ChatScreens._stack.isNotEmpty` —
                // whether the customer DRILLED IN from somewhere — while what
                // decides whether this bar has anything to say is whether
                // they are looking at a conversation at all.
                //
                // The two only agree for a customer who arrived through Home
                // or Messages. A host that opens the panel directly ON a
                // conversation — `ChatWidgetCubit(sessionId: …)`, which
                // `example/lib/main.dart:472` passes straight through from
                // its own config, or `initialScreen: ScreenName.conversation`
                // — starts with an EMPTY stack (`ChatScreens` is CONSTRUCTED
                // at that screen rather than pushed to it), so `canGoBack`
                // was false from the first frame and
                // this header never mounted at all. That took the ⋯ menu with
                // it: no End conversation (and so no route to the rating card
                // that follows one), no Start new, no Privacy, no session
                // switcher and no identity — on a live conversation where
                // `cubit.canEndConversation` was true the whole time. The row
                // was backed; there was simply nowhere to press it. Pinned by
                // `header_menu_mount_test.dart`.
                //
                // ── The old gate was wrong in BOTH directions ─────────────
                //
                // It is tempting to read this as a pure widening — every
                // `ChatScreens.go` in the Cubit targets
                // `ScreenName.conversation`, so surely `canGoBack` implied
                // "on a conversation". It does not, and the counter-example
                // is ordinary: `ChatScreens.swap` (what `switchTab` calls)
                // changes the screen WITHOUT clearing the stack, and its own
                // test pins that on purpose — `chat_screens_test.dart`'s
                // "the earlier go() is still there". So a customer who drills
                // into a conversation and then taps the Messages tab is on
                // Messages with `canGoBack` still true, and the old gate drew
                // this whole conversation header — identity, avatar, session
                // switcher, ⋯ and an unconditional back arrow — on top of
                // their message list.
                //
                // Reading the screen fixes that leak in the same move as the
                // missing header, because the screen is the fact the header
                // was always about. Both directions are pinned by
                // `header_menu_mount_test.dart`.
                //
                // `PopScope.canPop` above deliberately still reads
                // `canGoBack`: back is about the back history, and returning
                // a tab-switching customer to where they came from is what
                // `ChatScreens` is designed to do.
                appBar: state.screen == ScreenName.conversation
                    ? _ConversationAppBar(state: state, cubit: widget.cubit)
                    : null,
                // The unavailable panel takes over the whole body, in place
                // of whichever screen was active, the moment the connection
                // has genuinely given up (see kTerminalConnectionStates) —
                // never layered alongside the screen it replaces, so there is
                // no composer left underneath it for a customer to type into
                // a conversation that has nowhere to go.
                body: kTerminalConnectionStates.contains(state.connectionState)
                    ? UnavailableView(
                        config: state.config, onTryAgain: widget.cubit.connect)
                    // The bar sits ABOVE whichever screen is active and
                    // outside it, because it is not a fact about any one
                    // screen: it survives every move between Home, Messages
                    // and a conversation, exactly as losing your signal does.
                    //
                    // Above the app bar would be wrong for a different reason
                    // — the app bar only exists on a drill-down (see
                    // `canGoBack`), so a banner anchored to it would be
                    // invisible on the two screens a customer starts on.
                    //
                    // Never over UnavailableView: `resolveOfflineBanner`
                    // returns null for both terminal states anyway, and the
                    // branch above means there is no composer left underneath
                    // to make a promise about.
                    : Column(
                        children: <Widget>[
                          OfflineBanner(
                            view: resolveOfflineBanner(
                              connectionState: state.connectionState,
                              online: state.online,
                              failedAttempts: state.failedAttempts,
                              queuedCount: state.queuedCount,
                            ),
                          ),
                          Expanded(
                            // `onClose` is handed to the two screens that
                            // carry the control rather than drawn here, so
                            // it sits with the rest of each screen's own
                            // layout — Home's above its hero band, Messages'
                            // above its search box. A bar drawn at this
                            // level would be the "second, generic header"
                            // the app bar above is gated to avoid. Null
                            // reaches them as null and draws nothing; see
                            // [ChatWidget.onClose].
                            child: switch (state.screen) {
                              ScreenName.home =>
                                HomeScreen(onClose: widget.onClose),
                              ScreenName.messages =>
                                MessagesScreen(onClose: widget.onClose),
                              ScreenName.conversation =>
                                const ConversationScreen(),
                            },
                          ),
                        ],
                      ),
                bottomNavigationBar: ChatBottomNav(
                  active: state.screen,
                  // The unread behind the tab, not the unread on the page:
                  // this badge is a promise about what the Messages screen
                  // will show, and that screen no longer shows closed
                  // conversations. The chime above now watches this same
                  // number rise, so the sound and the badge cannot disagree
                  // about whether anything happened. `state.unreadCount` —
                  // the whole-page sum — is untouched as the RECORD of what
                  // the host supplied; see [ChatWidgetState.unreadCount].
                  unreadCount: state.customerVisibleUnreadCount,
                  onSelect: widget.cubit.switchTab,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ConversationAppBar extends StatelessWidget
    implements PreferredSizeWidget {
  const _ConversationAppBar({required this.state, required this.cubit});

  final ChatWidgetState state;
  final ChatWidgetCubit cubit;

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      // T14's IdentityHeader, not a second hand-built title.
      //
      // What this replaced re-derived identity as a bare
      // `handledBy?.displayName` with NO `isHandledByCurrent` gate, which is
      // the exact stale-agent bug that component exists to close: a session
      // reactivated to WAITING_FOR_AGENT keeps its previous agent
      // server-side, so a departed agent's name stayed in the header. It
      // also fell back to the literal 'Conversation' rather than the
      // merchant's own configured title.
      title: IdentityHeader(
        session: state.session,
        // `config.title` is the merchant's; 'Conversation' stays the last
        // resort for a tenant that published none. Composing a new
        // conversation outranks both — there is nobody to name yet.
        fallbackTitle: state.composingNew
            ? 'New conversation'
            : (state.config.title ?? 'Conversation'),
      ),
      // The back arrow is the one part of this bar that IS about the back
      // history, so it alone keeps the `canGoBack` gate the whole header used
      // to carry. A customer the host opened straight onto a conversation has
      // nowhere to go back TO; the bottom nav is how they reach Home.
      //
      // `automaticallyImplyLeading: false` is required, not tidiness: with a
      // null `leading` the default deduces one from the enclosing Navigator —
      // which here is the HOST's, since this package mounts no MaterialApp of
      // its own (see this library's header). That would paint a back arrow
      // that pops the host's route out from under the panel.
      // https://api.flutter.dev/flutter/material/AppBar/automaticallyImplyLeading.html
      automaticallyImplyLeading: false,
      leading: state.canGoBack ? BackButton(onPressed: cubit.back) : null,
      actions: <Widget>[
        // Reads the SAME `isHandledByCurrent` gate the title does, which is
        // what stops a face of Ada sitting beside "Acme Support".
        HeaderAvatar(session: state.session, config: state.config),
        // Surface 2 of the session picker, mounted where its popover needs to
        // be — a customer already inside one conversation is otherwise stuck
        // in it with no way back.
        //
        // ── Right-aligned is a requirement, not a preference ──────────────
        //
        // The panel is 300px wide and anchors `bottomRight → topRight`
        // (session_switcher.dart:196-199), so it hangs LEFTWARD from the
        // toggle's right edge and does NOT clamp to the viewport. A toggle
        // near the left edge therefore puts most of the panel off-screen,
        // where taps hit nothing. `actions:` is the right-hand side of the
        // app bar, which is why the header components were put here; this
        // sits inboard of the ⋯ menu so the ⋯ stays last, and its right edge
        // is still a full panel-width clear of the left edge. Pinned by
        // `session_switcher_mount_test.dart`, which measures the rendered
        // panel rather than trusting this comment.
        //
        // ── The gate is the CALLER's, and it is exactly length > 0 ────────
        //
        // `session-picker.ts`'s own header: "the client rule is exactly
        // `sessions.length > 0` ⇒ show the picker", decided outside the
        // module because whether to reveal a surface at all is a screen-flow
        // choice. The module itself renders an empty list as an empty-state
        // ROW, never as a hidden component, and asks no guest question of its
        // own — re-deriving "is this a guest" here would be the second
        // derivation D10 exists to forbid. The list is empty for a guest
        // because the server says so, and that is the whole rule.
        //
        // Asked over `customerVisibleSessions` and not over the raw page,
        // because those are the rows this panel would actually contain: a
        // customer whose only other conversation the merchant has CLOSED
        // would otherwise get a toggle in the header that opens onto "No
        // other conversations yet." — a control offering a choice that is
        // not there. One gate and one list, both from
        // [ChatWidgetState.customerVisibleSessions].
        if (state.customerVisibleSessions.isNotEmpty)
          SessionSwitcher(
            sessions: state.customerVisibleSessions,
            currentSessionId: state.session?.sessionId,
            onSelect: cubit.selectSession,
            onStartNew: cubit.startNewConversation,
            // Left at its default `false`. The busy flag exists for
            // `SessionPickerScreen`, whose Start mints a session over a round
            // trip; `startNewConversation` only raises the new-conversation
            // form and returns, so there is no in-flight state to show and a
            // spinner here would describe nothing.
          ),
        HeaderMenu(
          canEnd: cubit.canEndConversation,
          privacyUrl: state.config.privacyUrl,
          // The merchant's published flag AND a reporter to carry it out.
          //
          // Both halves, for the one reason header_menu.dart states: an
          // unbacked item is absent from `headerMenuEntries` entirely,
          // because a row that looks like a feature and does nothing is a
          // promise broken in front of the customer. `config.reportIssue` is
          // the merchant's half — the reference gates on it alone, since a
          // DOM widget always has its own `fetch`. `cubit.canReportIssue` is
          // the half Flutter adds: [IssueReporter] is a seam the HOST wires,
          // exactly as `ChatSessionActions` is, and a host that wired none
          // gets the row hidden rather than a form whose Send always fails.
          // The same pairing `canEnd` above already makes.
          reportIssue: state.config.reportIssue && cubit.canReportIssue,
          muted: state.muted,
          // The merchant's chime flag, and the third row gated on its own
          // backing. `Chime` refuses on `!sound` BEFORE it looks at `muted`
          // (chime.dart), so on a tenant that published none — and `sound`
          // defaults to false — mute and unmute both changed nothing a
          // customer could hear. Offering the row anyway was the one place
          // this menu broke its own rule, and it is what "mute notification
          // and unmute notification not working" actually was.
          //
          // Read off `state.config`, so a config that arrives late through
          // `applyRemoteConfig` turns the row on with the same rebuild that
          // repaints everything else it decides.
          sound: state.config.sound,
          onStartNew: cubit.startNewConversation,
          onEndConversation: cubit.openEndConversation,
          onReportIssue: cubit.openReportIssue,
          onMuteChange: cubit.setMuted,
          onOpenPrivacy: openPrivacyUrl,
        ),
      ],
    );
  }
}
