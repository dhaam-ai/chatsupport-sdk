/// The conversation header: its ⋯ menu, the identity it shows, the chime that
/// announces a reply, and the two forms the menu opens.
///
/// The Flutter counterpart of `packages/widget/src/ui/header-menu.ts`,
/// `ui/identity-header.ts`, `ui/chime.ts` and `ui/report-issue.ts`, plus the
/// two raw routes `widget.ts` issues for them (`transcript/email` at :3669 and
/// `report-issue` at :3712 — neither has a REST adapter or an OpenAPI entry,
/// and `widget.ts` is the only authority for either).
///
/// ── Seams, not plugins ───────────────────────────────────────────────────
///
/// `TranscriptEmailer`, `IssueReporter` and `ChimePlayer` are function types,
/// so every test in this module supplies a closure and none of them reaches a
/// socket or a platform channel. Same discipline as the attachment module's
/// `AttachmentPicker`/`AttachmentUploader`, and for the same reason: a module
/// that calls a platform singleton directly is a module whose tests cannot run
/// in CI. `transcript_email.dart` holds the real REST-backed implementations
/// of both routes.
library;

export 'chime.dart';
export 'header_avatar.dart';
export 'header_menu.dart';
export 'identity_header.dart';
