/// Picking a file, refusing the ones that cannot be sent, uploading the rest,
/// and drawing the result in the transcript.
///
/// The Flutter counterpart of the attachment half of
/// `packages/widget/src/ui/composer.ts`.
///
/// ── Two seams, and neither of them is a plugin ───────────────────────────
///
/// `AttachmentPicker` is where a platform file chooser plugs in and
/// `AttachmentUploader` is where T7's `POST /upload` does. Both are function
/// types, so every test in this module supplies a closure and none of them
/// reaches a `MethodChannel` or a socket. That is not tidiness: a picker is a
/// static on a platform singleton and cannot be faked after the fact, so a
/// module that calls one directly is a module whose tests cannot run in CI.
///
/// `file_picker_attachment_picker.dart` holds the one real implementation and
/// is the only file here that imports a plugin.
///
/// ── The order of operations, and why it is upload-on-SEND ────────────────
///
/// A pick fills the draft; the bytes do not move until the customer actually
/// sends. `composer.ts` does the same, and the reason is concrete: a file
/// uploaded the moment it is picked and then never sent is an orphan in the
/// merchant's bucket that nothing in the transcript will ever reference.
///
/// What this module does NOT copy from `composer.ts` is that function's
/// draft handling. There, `submit()` clears the pending file BEFORE awaiting
/// the upload, so a failed upload loses the customer's file and leaves only a
/// sentence. Here the draft survives every failure — see
/// `AttachmentDraftController.uploadDraft`.
library;

export 'attachment_bubble.dart';
export 'attachment_composer_controls.dart';
export 'attachment_draft.dart';
export 'attachment_draft_controller.dart';
export 'file_picker_attachment_picker.dart';
