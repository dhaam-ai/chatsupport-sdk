/// The field half of the shared form substrate: what a console-defined field
/// IS, the live state behind one on screen, and the two list-level questions
/// every surface asks of a set of them.
///
/// See `forms.dart` for why this module exists at all. The short version: the
/// pre-chat form, the out-of-hours form, report-issue and new-conversation all
/// render the SAME console-defined field list, so if they each map types,
/// mark optionality and collect answers themselves, a merchant's field renders
/// and reports differently depending on which screen happened to ask it.
///
/// ── Why the spec and the live state are two types ────────────────────────
///
/// [FieldSpec] is what the console said — immutable, comparable, safe to hold
/// in widget state and rebuild from. [FieldView] is what is on screen right
/// now: a `TextEditingController`, a `FocusNode`, and a lifetime that has to
/// be disposed. Folding them into one type would make the console's
/// description of a field un-testable without a widget tree, and would put a
/// disposable in every place that only wanted to read a label.
library;

import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';

/// The three field kinds the console can publish.
///
/// A closed enum rather than a string, so a fourth kind arriving on the wire
/// is a decision someone has to make at the parse site rather than a silent
/// fall-through to a plain text box here.
enum FieldKind {
  /// A free-text answer. The default for anything the console did not type.
  text,

  /// An email address.
  email,

  /// A telephone number.
  phone,
}

/// A console-defined field. Structurally the wire's `PreChatField`.
///
/// Extends [Equatable] rather than hand-writing `==`/`hashCode`, matching
/// `appearance.dart`'s own note on the same choice.
///
/// [isRequired] is the wire's `required`. Spelled with the `is` prefix here
/// because Dart's own convention for a boolean property wants a verb phrase,
/// and because `required this.required` in the constructor below reads as a
/// typo rather than as a field. Nothing about the wire changes: the parse site
/// writes `isRequired: json['required']`.
@immutable
class FieldSpec extends Equatable {
  const FieldSpec({
    required this.id,
    required this.label,
    required this.type,
    required this.isRequired,
  });

  /// The key this field's answer is reported under. Merchant-defined.
  final String id;

  /// What the customer is asked. Free text a merchant wrote — never trusted
  /// to be short, and never parsed for meaning.
  final String label;

  final FieldKind type;

  /// Whether an empty answer blocks the submit.
  final bool isRequired;

  @override
  List<Object?> get props => <Object?>[id, label, type, isRequired];
}

/// The keyboard a field kind should summon.
///
/// `phone` is the one that earns this table on its own: it is the difference
/// between a numeric keypad and a full QWERTY keyboard on the device most
/// customers are holding, and it is the only one of the three a customer can
/// physically feel getting wrong.
TextInputType keyboardTypeFor(FieldKind kind) {
  switch (kind) {
    case FieldKind.text:
      return TextInputType.text;
    case FieldKind.email:
      return TextInputType.emailAddress;
    case FieldKind.phone:
      return TextInputType.phone;
  }
}

/// A best-effort autofill hint, so the platform can fill the two fields it
/// reliably knows.
///
/// Guessed from the field TYPE first and the label only as a fallback, because
/// the type is structured data and the label is free text a merchant wrote.
/// Ported from `ui/forms.ts`'s `autocompleteFor`, with one deliberate
/// difference: that function returns the HTML token `'on'` for the
/// no-idea case, and Flutter has no such token — an empty hint list is how
/// you say "no opinion" here, so that is what this returns.
List<String> autofillHintsFor(FieldSpec spec) {
  switch (spec.type) {
    case FieldKind.email:
      return const <String>[AutofillHints.email];
    case FieldKind.phone:
      return const <String>[AutofillHints.telephoneNumber];
    case FieldKind.text:
      return RegExp('name', caseSensitive: false).hasMatch(spec.label)
          ? const <String>[AutofillHints.name]
          : const <String>[];
  }
}

/// One field's live state: the text in it, and where focus goes when it is the
/// one holding up the submit.
///
/// Owns a [TextEditingController] and a [FocusNode], so it owns a lifetime —
/// every caller that builds these must [dispose] them, exactly as it would for
/// controllers it created itself.
class FieldView {
  FieldView(this.spec)
      : controller = TextEditingController(),
        focusNode = FocusNode(debugLabel: 'FieldView(${spec.id})');

  final FieldSpec spec;

  final TextEditingController controller;

  /// The node [focus] moves to, and the node [FormFieldInput] attaches to the
  /// text box. Held here rather than inside the widget so that
  /// [firstMissingRequired]'s answer is actionable by a caller that has no
  /// `BuildContext` and no idea where the widget lives in the tree.
  final FocusNode focusNode;

  /// What the customer typed, trimmed.
  ///
  /// A getter rather than `ui/forms.ts`'s `value()` because reading the
  /// current contents of a text box is property access in Dart — the closest
  /// precedent is `TextEditingController.text`, which is itself a getter.
  /// Trimming here rather than at each call site is the whole point: a
  /// surrounding space is a typing artefact, and one surface treating
  /// `' '` as an answer while another treats it as blank is precisely the
  /// divergence this module exists to prevent.
  String get value => controller.text.trim();

  /// The label as it should appear on screen and be announced.
  ///
  /// ── Optional is marked; required is NOT ────────────────────────────────
  ///
  /// This is the inverse of the usual asterisk convention and it is
  /// deliberate: it is the same choice the console's own preview makes, so a
  /// merchant sees their form labelled the way they designed it. Do not
  /// "fix" this to mark required fields instead — the two previews would then
  /// disagree about every form in the product.
  String get displayLabel =>
      spec.isRequired ? spec.label : '${spec.label} (optional)';

  /// Moves keyboard focus here. Called with the answer from
  /// [firstMissingRequired].
  void focus() => focusNode.requestFocus();

  void dispose() {
    controller.dispose();
    focusNode.dispose();
  }
}

/// The sentence shown when [spec] is required and empty.
///
/// One function so that seven surfaces cannot drift into seven wordings of
/// the same refusal. Uses [FieldSpec.label] and not [FieldView.displayLabel]
/// because a required field never carries the "(optional)" marker anyway, and
/// building the message from the raw label keeps it true if that ever changes.
String missingRequiredMessage(FieldSpec spec) => '${spec.label} is required.';

/// The first required field left empty, or `null` when every one is answered.
///
/// Returns the FIELD rather than a boolean so the caller can move focus to it.
/// A form that says "fill in the fields above" without saying which one is a
/// scavenger hunt on a six-field form — and on a screen reader it is worse
/// than that, because "above" is a spatial claim that does not survive being
/// read aloud.
///
/// Order matters and is the order the fields were given in, which is the order
/// they are rendered in: the customer is sent to the first thing they missed,
/// not to whichever one this happened to check last.
FieldView? firstMissingRequired(Iterable<FieldView> fields) {
  for (final FieldView field in fields) {
    if (field.spec.isRequired && field.value.isEmpty) return field;
  }
  return null;
}

/// The answers, keyed by [FieldSpec.id], with every blank left out.
///
/// ── An unanswered optional field is ABSENT, never `''` ─────────────────────
///
/// An empty string is an answer: it says the customer was asked and replied
/// with nothing. Absence says they were not asked, or chose not to say. Those
/// reach an agent's screen as different things, and one of them is a lie. The
/// same distinction is why the pre-chat surface reports an absent map when no
/// fields showed and an empty one when they showed and were all skipped.
///
/// Required fields are guaranteed non-empty by [firstMissingRequired] having
/// already run, so the one rule here covers both kinds.
Map<String, String> collectAnswers(Iterable<FieldView> fields) {
  final Map<String, String> answers = <String, String>{};
  for (final FieldView field in fields) {
    final String value = field.value;
    if (value.isNotEmpty) answers[field.spec.id] = value;
  }
  return answers;
}

/// One labelled text box, built from a [FieldView].
///
/// ── How the label reaches assistive tech ───────────────────────────────────
///
/// Through [InputDecoration.labelText], not a sibling `Text` and not a
/// hand-rolled [Semantics] wrapper. `InputDecorator.visitChildrenForSemantics`
/// visits its label immediately before its input and inside the same semantics
/// container, so the label becomes part of the field's accessible name — which
/// is exactly what `ui/forms.ts` gets from `<label for="…">`, obtained here the
/// way the framework already provides rather than by porting the DOM idiom.
///
/// ── What Flutter 3.24.4 cannot say, and what is done instead ───────────────
///
/// There is no required-ness flag in this SDK's `SemanticsFlag` (checked, not
/// assumed), so unlike the web original there is no attribute that makes a
/// screen reader announce "required" on arrival. Required-ness therefore
/// reaches assistive tech two other ways, both of which this module owns: the
/// ABSENCE of the "(optional)" suffix in the announced label, and — at the
/// moment it actually matters — [missingRequiredMessage] naming the field in a
/// live region while focus moves to it. The second is the one that does the
/// work: it fires when the customer is blocked, rather than asking them to
/// have remembered a label suffix from earlier in the form.
class FormFieldInput extends StatelessWidget {
  const FormFieldInput({super.key, required this.field, this.textInputAction});

  final FieldView field;

  /// Lets a caller wire "next field" / "done" behaviour across a run of
  /// fields. Nothing here decides it: only the caller knows what comes after
  /// the last field on ITS surface.
  final TextInputAction? textInputAction;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: field.controller,
      focusNode: field.focusNode,
      keyboardType: keyboardTypeFor(field.spec.type),
      autofillHints: autofillHintsFor(field.spec),
      textInputAction: textInputAction,
      decoration: InputDecoration(
        labelText: field.displayLabel,
        border: const OutlineInputBorder(),
      ),
    );
  }
}
