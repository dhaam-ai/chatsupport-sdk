/// The out-of-hours form — "leave a message, the team is closed".
///
/// Not to be confused with `ui/offline_banner.dart`, which is about the
/// NETWORK being gone. Two different offlines, and the difference is who is
/// missing: the banner says this device cannot reach the service and every
/// message is held; this says the service is reachable and nobody is there to
/// read one right now. Deliberately separate modules, because a customer
/// meeting both at once must be told both things.
///
/// Split across two files for the reason the consent gate is: the RULES —
/// which of the merchant's fields survive alongside the built-ins, and how
/// the answers become one message a human reads — are pure Dart that a test
/// can drive without a widget tree, and the form is a widget with a lifetime.
///
/// See `offline_form_view.dart`'s header for why business hours are the
/// server's to decide, and `offline_message.dart`'s for why the built-in
/// label match is anchored rather than a substring.
library;

export 'offline_form_view.dart';
export 'offline_message.dart';
