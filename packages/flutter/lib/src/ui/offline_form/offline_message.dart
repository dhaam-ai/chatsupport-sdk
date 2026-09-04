/// What the out-of-hours form produces, and the two rules that shape it: which
/// of the merchant's fields survive alongside the built-ins, and how the
/// answers become a message a human reads.
///
/// Split from the widget for the reason `consent_gate.dart` is split from its
/// notice: [kOfflineBuiltInLabel] is the rule a merchant's "Name of the
/// product you ordered" is judged by, and it must be assertable without
/// pumping a frame.
library;

import 'package:equatable/equatable.dart';
import 'package:flutter/foundation.dart';

import '../../forms/forms.dart';

/// The three flat strings the offline path produces.
///
/// Flat and not a record with a schema, because the offline path produces a
/// message a HUMAN reads — see [offlineMessageBody]. Extends [Equatable] for
/// the same reason [FieldSpec] does: a test asserting what was submitted
/// should compare values, not identities.
@immutable
class OfflineMessage extends Equatable {
  const OfflineMessage({
    required this.name,
    required this.contact,
    required this.message,
  });

  /// What the visitor is called. Always asked.
  final String name;

  /// An email address or a phone number — whichever the visitor gave. Always
  /// asked, because this is the only way back to somebody who wrote in while
  /// the team was closed.
  final String contact;

  /// The typed message, with any custom-field answers appended.
  final String message;

  @override
  List<Object?> get props => <Object?>[name, contact, message];
}

/// Console fields that duplicate the form's own two built-ins.
///
/// ── Anchored, not a substring match ──────────────────────────────────────
///
/// The console seeds every workspace with "Your name" and "Email address", so
/// without this, every merchant who never touched their pre-chat settings gets
/// a form asking for a name twice. It matches the seeded labels EXACTLY and
/// case-insensitively rather than by substring, because a merchant's "Name of
/// the product you ordered" must survive — a substring rule would swallow it,
/// and the customer would then be asked their name and never asked which
/// product, with nothing on screen to say a question went missing.
///
/// `^` and `$` are load-bearing. Dart's [RegExp.hasMatch] searches rather than
/// anchoring by default (the same as JavaScript's `RegExp.test`, which the
/// reference relies on the same anchors for), so removing either one turns
/// this into the substring rule it exists not to be.
final RegExp kOfflineBuiltInLabel = RegExp(
  r'^(name|your name|email|email address|phone|contact|contact details)$',
  caseSensitive: false,
);

/// The merchant's fields, minus the ones that duplicate the built-ins.
///
/// Trims before testing, because a label with a trailing space is a merchant's
/// typing artefact and not a different question. Order is the merchant's own,
/// which is the order the form renders and an agent reads.
List<FieldSpec> offlineCustomFields(Iterable<FieldSpec> fields) => fields
    .where(
        (FieldSpec spec) => !kOfflineBuiltInLabel.hasMatch(spec.label.trim()))
    .toList(growable: false);

/// The shortest message this form will send.
///
/// Four characters is not a quality bar — it is the difference between a
/// message and a slip. "hi" out of hours produces a ticket an agent opens
/// tomorrow morning with nothing in it to answer.
const int kOfflineMinMessageLength = 4;

/// The typed message with the answered custom fields appended, as
/// "Label: value" lines.
///
/// ── Flattened into the body, on purpose ──────────────────────────────────
///
/// Whatever the merchant configured is appended as prose rather than sent as
/// structured data. There is no structured place for it to go — the offline
/// path produces a message a human reads, not a record with a schema — and a
/// merchant who added "Order number" wants to SEE the order number in the
/// message, not have it dropped because no column matched. The same choice the
/// reference makes.
///
/// An unanswered optional field is left out ENTIRELY, never appended as
/// "Order number: ". An empty line under a label says the customer was asked
/// and answered with nothing; absence says they skipped it. Those read as
/// different things to the agent, and one of them is a lie — the same
/// distinction [collectAnswers] draws for the structured path.
///
/// Ordered by the FIELDS, which is the merchant's order and the order they
/// were rendered in, never by whatever the customer filled in first.
String offlineMessageBody({
  required String message,
  required Iterable<FieldView> customFields,
}) {
  return <String>[
    message.trim(),
    for (final FieldView field in customFields)
      if (field.value.isNotEmpty) '${field.spec.label}: ${field.value}',
  ].join('\n\n');
}
