import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reproduces the `insertAtCaret` half of
/// `packages/widget/test/emoji.test.ts:18-75` — five cases, minus the sixth
/// (focus), which is the composer's job here rather than this function's and
/// is asserted in `composer_test.dart`.
void main() {
  TextEditingValue at(String text, int start, [int? end]) => TextEditingValue(
        text: text,
        selection: TextSelection(baseOffset: start, extentOffset: end ?? start),
      );

  test('inserts at the caret rather than appending to the end', () {
    expect(
      withInsertionAtCaret(at('thanks so much', 6), '👍').text,
      'thanks👍 so much',
    );
  });

  test('leaves the caret after what it inserted, so typing continues in place',
      () {
    final TextEditingValue result = withInsertionAtCaret(at('hi', 2), '🎉');
    expect(result.selection.baseOffset, result.text.length);
    expect(result.selection.extentOffset, result.text.length);
    expect(result.selection.isCollapsed, isTrue);
  });

  test('replaces a selection, like every other text control', () {
    expect(withInsertionAtCaret(at('that is bad', 8, 11), '😡').text,
        'that is 😡');
  });

  // Dragging right-to-left reports base > extent. Treating that pair as
  // (start, end) without ordering it throws on replaceRange.
  test('replaces a selection dragged backwards, too', () {
    final TextEditingValue result =
        withInsertionAtCaret(at('that is bad', 11, 8), '😡');
    expect(result.text, 'that is 😡');
    expect(result.selection.baseOffset, 'that is 😡'.length);
  });

  test('appends when the box is empty', () {
    expect(withInsertionAtCaret(TextEditingValue.empty, '❤️').text, '❤️');
  });

  // A field that has never been focused reports -1, which is not an offset.
  test('treats a never-focused field as "at the end" rather than throwing', () {
    const TextEditingValue untouched = TextEditingValue(text: 'draft');
    expect(untouched.selection.baseOffset, -1, reason: 'the case under test');
    final TextEditingValue result = withInsertionAtCaret(untouched, '!');
    expect(result.text, 'draft!');
    expect(result.selection.baseOffset, 'draft!'.length);
  });

  // The text under a live IME composition has just been rewritten, so the
  // range the platform was told about no longer describes anything.
  test('clears the composing range it just invalidated', () {
    const TextEditingValue composing = TextEditingValue(
      text: 'にほん',
      selection: TextSelection.collapsed(offset: 3),
      composing: TextRange(start: 0, end: 3),
    );
    expect(withInsertionAtCaret(composing, '🎉').composing, TextRange.empty);
  });

  testWidgets('insertAtCaret keeps the caret rather than jumping to the end',
      (WidgetTester tester) async {
    final TextEditingController controller =
        TextEditingController(text: 'Hi there');
    addTearDown(controller.dispose);
    controller.selection = const TextSelection.collapsed(offset: 3);

    insertAtCaret(controller, '👍');

    expect(controller.text, 'Hi 👍there');
    // Assigning `.text` instead of `.value` would have put this at 10.
    expect(controller.selection.baseOffset, 5);
  });
}
