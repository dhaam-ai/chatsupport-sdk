/// Putting something into the message box the way a keystroke would.
///
/// Ports `packages/widget/src/ui/emoji.ts`'s `insertAtCaret` — the pure half
/// of the emoji picker, split out there for the same reason it is split out
/// here: it is the part worth asserting directly, and it is a function of the
/// field's own value and selection rather than of any widget.
library;

import 'package:flutter/widgets.dart';

/// [value] with [insertion] written at the caret and the caret left AFTER it.
///
/// Three behaviours, each of them a departure from "append to the end":
///
/// 1. **At the caret, not at the end.** Appending teleports a glyph out of a
///    half-written sentence whenever the customer had clicked back into the
///    middle of it. This is `setRangeText`'s job in the reference.
/// 2. **The caret lands after the insertion**, so typing continues in place
///    rather than jumping back to where it was.
/// 3. **A selection is replaced.** Typing over selected words replaces them
///    in every other text control the customer has ever used, and a picker
///    that instead inserted alongside the selection would be the odd one out.
///
/// A field that has never been focused reports a selection of `-1`, which is
/// not an offset — treating it as one throws on `replaceRange`. That case is
/// read as "the end of the text", which for an untouched empty box is also
/// offset zero, so the first glyph a customer ever picks lands correctly.
///
/// The composing range is cleared: the text underneath a live IME composition
/// has just been rewritten, so the range the platform was told about no
/// longer describes anything.
TextEditingValue withInsertionAtCaret(
  TextEditingValue value,
  String insertion,
) {
  final String text = value.text;
  final TextSelection selection = value.selection;
  final int start = selection.start >= 0 ? selection.start : text.length;
  final int end = selection.end >= 0 ? selection.end : start;
  // A reversed selection (dragged right-to-left) reports base > extent, so
  // order the pair rather than trusting start <= end.
  final int from = start <= end ? start : end;
  final int to = start <= end ? end : start;
  return TextEditingValue(
    text: text.replaceRange(from, to, insertion),
    selection: TextSelection.collapsed(offset: from + insertion.length),
    composing: TextRange.empty,
  );
}

/// [withInsertionAtCaret] applied to a live controller.
///
/// Assigning `.value` rather than `.text` is load-bearing: `.text` resets the
/// selection to the end of the whole field, which would undo behaviour 2
/// above for every insertion made into the middle of a sentence.
void insertAtCaret(TextEditingController controller, String insertion) {
  controller.value = withInsertionAtCaret(controller.value, insertion);
}
