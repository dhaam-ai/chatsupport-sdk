/// Flutter UI for the Dhaam chat widget.
///
/// `dhaam_chat` (the package this one depends on) is deliberately pure Dart —
/// no Flutter import, no HTTP, a protocol client and nothing else. This
/// package is the other half: the config fetch `dhaam_chat` has no HTTP
/// client to make, and the screens that turn its streams into something a
/// customer can look at.
///
/// This file grows one export per slice as each piece lands, the same shape
/// `dhaam_chat.dart` itself has.
library;

export 'src/chat_widget.dart';
// `remote_config.dart` re-exports `appearance.dart` itself (the two are one
// module split across two files — see remote_config.dart's header), so these
// two lines are the whole config surface.
export 'src/config/remote_config.dart';
export 'src/config/remote_config_client.dart';
export 'src/nav/chat_screens.dart';
export 'src/session/chat_session_summary.dart';
export 'src/session/session_display.dart';
export 'src/state/chat_widget_cubit.dart';
export 'src/state/chat_widget_state.dart';
export 'src/state/widget_chat_client.dart';
export 'src/theme/chat_theme.dart';
export 'src/theme/header_style.dart';
export 'src/ui/chat_bottom_nav.dart';
export 'src/ui/common_questions_list.dart';
export 'src/ui/composer.dart';
export 'src/ui/conversation_screen.dart';
export 'src/ui/hero_header.dart';
export 'src/ui/home_screen.dart';
export 'src/ui/image_safety.dart';
export 'src/ui/messages_screen.dart';
export 'src/ui/new_conversation_view.dart';
export 'src/ui/quick_replies.dart';
export 'src/ui/topic_chips.dart';
