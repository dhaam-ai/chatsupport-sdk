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

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'nav/chat_screens.dart';
import 'state/chat_widget_cubit.dart';
import 'state/chat_widget_state.dart';
import 'theme/chat_theme.dart';
import 'ui/chat_bottom_nav.dart';
import 'ui/conversation_screen.dart';
import 'ui/home_screen.dart';
import 'ui/messages_screen.dart';

class ChatWidget extends StatefulWidget {
  const ChatWidget({super.key, required this.cubit});

  final ChatWidgetCubit cubit;

  @override
  State<ChatWidget> createState() => _ChatWidgetState();
}

class _ChatWidgetState extends State<ChatWidget> {
  @override
  void initState() {
    super.initState();
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
      child: BlocBuilder<ChatWidgetCubit, ChatWidgetState>(
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
                body: switch (state.screen) {
                  ScreenName.home => const HomeScreen(),
                  ScreenName.messages => const MessagesScreen(),
                  ScreenName.conversation => const ConversationScreen(),
                },
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
    // Mirrors home_screen.dart's own recent-row title rule: WHO handled it
    // is real; nothing here invents a subject line the customer never
    // wrote (chat_session_summary.dart's own rule, applied to the one
    // session this Cubit tracks rather than a list of summaries).
    final String title = state.composingNew ? 'New conversation' : (state.session?.handledBy?.displayName ?? 'Conversation');

    return AppBar(
      title: Text(title),
      leading: BackButton(onPressed: cubit.back),
    );
  }
}
