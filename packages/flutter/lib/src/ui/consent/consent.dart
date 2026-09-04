/// The consent gate: the merchant's notice, the visitor's answer, and the
/// memory of it.
///
/// Split across two files for the reason the form substrate is: the RULES
/// ([consentGating], [consentSatisfied], [ConsentGate]) are pure Dart that a
/// test can drive with no widget tree, and the notice is a widget with a
/// lifetime. Folding them into one file would make "is this notice actually
/// gating?" — the question a merchant with an empty text box gets wrong —
/// untestable without pumping a frame.
///
/// See `consent_gate.dart`'s header for what this gate claims and what it
/// deliberately does not.
library;

export 'consent_gate.dart';
export 'consent_notice.dart';
