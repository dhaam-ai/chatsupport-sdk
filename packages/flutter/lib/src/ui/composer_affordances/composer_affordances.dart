/// The three things the composer can do besides carry typed words: take a
/// suggestion from a chip, take a glyph from a palette, and take a URL from a
/// popover the widget owns.
///
/// The Flutter counterpart of `packages/widget/src/ui/emoji.ts` plus the
/// link-popover and `submit(text)` halves of `ui/composer.ts`. They live in
/// one module because they share one rule: an insertion is not finished until
/// the same effects a keystroke has have happened — see
/// `CaretInsertion`'s doc for the full account of why skipping any of them is
/// a real bug rather than a missing polish step.
///
/// ── What is deliberately NOT here ────────────────────────────────────────
///
/// Attachment picking and voice capture also live in the composer's icon row
/// and are not in this module: they land with their own nodes, which own the
/// platform seams they need. This module has no plugin dependency at all —
/// the emoji grid is built from [kComposerEmoji], a const list of sixteen
/// strings, because a package that ships an emoji index would be several
/// times this widget's entire budget for a shortcut to a keyboard every
/// platform already has.
library;

export 'caret_insertion.dart';
export 'chip_submit_guard.dart';
export 'emoji_popover.dart';
export 'link_popover.dart';
