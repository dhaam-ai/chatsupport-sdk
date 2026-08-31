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

// `remote_config.dart` re-exports `appearance.dart` itself (the two are one
// module split across two files — see remote_config.dart's header), so these
// two lines are the whole config surface.
export 'src/config/remote_config.dart';
export 'src/config/remote_config_client.dart';
export 'src/nav/chat_screens.dart';
