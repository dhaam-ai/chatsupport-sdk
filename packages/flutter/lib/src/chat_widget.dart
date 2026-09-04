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
  const ChatWidget({super.key, required this.cubit, this.chime});

  final ChatWidgetCubit cubit;

  /// The reply chime, or null to build the default one.
  ///
  /// Injectable for the reason every other platform-touching thing in this
  /// package is (`AttachmentPicker`, `ChimePlayer`, `GeolocationProbe`): a
  /// widget that reaches a platform channel directly is a widget whose tests
  /// cannot run in CI. See `chime.dart` on why the default player is
  /// [SystemSound] rather than an audio plugin, and how a host replaces it.
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
    // first observation": `unreadCount` also FALLS (to zero, when the panel
    // is read), and a restored session's backlog must not greet a returning
    // visitor with a noise about messages they have already read.
    _chime.playOnUnreadRise(
      unread: widget.cubit.state.unreadCount,
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
        listenWhen: (ChatWidgetState previous, ChatWidgetState current) =>
            previous.unreadCount != current.unreadCount,
        listener: (BuildContext context, ChatWidgetState state) =>
            _chime.playOnUnreadRise(
          unread: state.unreadCount,
          // BOTH have to agree: `config.sound` is the merchant enabling a
          // chime at all, `muted` is this visitor silencing it. `Chime` is
          // the one place the two are combined, so no caller can satisfy one
          // and forget the other.
          sound: state.config.sound,
          muted: state.muted,
        ),
        builder: (BuildContext context, ChatWidgetState state) {
          final ThemeData theme = chatThemeData(state.config, MediaQuery.platformBrightnessOf(context));

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
                // Only the screen a customer DRILLED INTO (today: always the
                // conversation screen — see ChatWidgetCubit.startNewConversation
                // / .openConversation, the only two writers of canGoBack)
                // gets a back bar. Home and Messages are tabs, not
                // drill-downs, and Home already greets the customer via its
                // own HeroHeader — a second, generic bar above it would be
                // a redundant header, not a helpful one.
                appBar: state.canGoBack ? _ConversationAppBar(state: state, cubit: widget.cubit) : null,
                // The unavailable panel takes over the whole body, in place
                // of whichever screen was active, the moment the connection
                // has genuinely given up (see kTerminalConnectionStates) —
                // never layered alongside the screen it replaces, so there is
                // no composer left underneath it for a customer to type into
                // a conversation that has nowhere to go.
                body: kTerminalConnectionStates.contains(state.connectionState)
                    ? UnavailableView(config: state.config, onTryAgain: widget.cubit.connect)
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
                            child: switch (state.screen) {
                              ScreenName.home => const HomeScreen(),
                              ScreenName.messages => const MessagesScreen(),
                              ScreenName.conversation => const ConversationScreen(),
                            },
                          ),
                        ],
                      ),
                bottomNavigationBar: ChatBottomNav(
                  active: state.screen,
                  unreadCount: state.unreadCount,
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

class _ConversationAppBar extends StatelessWidget implements PreferredSizeWidget {
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
        fallbackTitle: state.composingNew ? 'New conversation' : (state.config.title ?? 'Conversation'),
      ),
      leading: BackButton(onPressed: cubit.back),
      actions: <Widget>[
        // Reads the SAME `isHandledByCurrent` gate the title does, which is
        // what stops a face of Ada sitting beside "Acme Support".
        HeaderAvatar(session: state.session, config: state.config),
        HeaderMenu(
          canEnd: cubit.canEndConversation,
          privacyUrl: state.config.privacyUrl,
          // FALSE, deliberately, and NOT `state.config.reportIssue`.
          //
          // `report_issue_form.dart` is built and unit-tested but has no
          // host: no surface, no Cubit method that opens one, and no
          // `IssueReporter` wired to the raw `report-issue` route. Offering
          // the row would put an item in front of the customer that does
          // nothing when pressed — the precise trap header_menu.dart's own
          // header documents, whose rule for an unbacked item is to HIDE it
          // rather than disable it. Flipping this to the config flag is the
          // one line that lights the row up once the form has somewhere to
          // open.
          reportIssue: false,
          muted: state.muted,
          onStartNew: cubit.startNewConversation,
          onEndConversation: cubit.openEndConversation,
          // Unreachable while `reportIssue` is false — `headerMenuEntries`
          // omits the row entirely, so nothing can select it. A no-op rather
          // than a throw: this is a menu, and crashing the panel if that
          // flag were ever flipped without the rest of the wiring would be a
          // worse failure than a silent one.
          onReportIssue: () {},
          onMuteChange: cubit.setMuted,
          onOpenPrivacy: openPrivacyUrl,
        ),
      ],
    );
  }
}
