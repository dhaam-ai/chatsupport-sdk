/// The one place that decides what happens to a picked file: which ones are
/// refused and in what words, when the bytes go up, and what survives a
/// failure.
///
/// The Flutter counterpart of `composer.ts`'s `acceptFile`, `setAttachment`,
/// `clearAttachment` and the attachment half of its `submit`.
library;

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:flutter/foundation.dart';

import '../../forms/forms.dart' show FormErrorReporter;
import 'attachment_draft.dart';

/// One composer's pending attachment: what is picked, whether it is going up
/// right now, and the one sentence it is currently telling the customer.
///
/// A [ChangeNotifier] rather than `setState`, for the same reason
/// `FormSubmitController` is one: in-flight-ness is not private to the widget
/// that started it. The send button, the attach button and the draft chip's
/// remove button all have to read the same flag, and a send button that
/// re-derives "is an upload running" from anything else is a second answer to
/// a question that already has one.
///
/// Owns a lifetime: every caller that constructs one must [dispose] it.
///
/// ── This controller does NOT know about `RemoteConfig.fileUploads` ───────
///
/// The gate lives at the widget (`AttachmentAttachButton`), once. Re-reading
/// the flag here as well would be two derivations of one fact — the shape
/// this port has already been bitten by twice (`isGuest` shown on one path
/// and not the other; `composingNew` collapsed into the surface slot for the
/// same reason), and the same call T11 makes when it keeps guest-gating
/// outside the session picker.
class AttachmentDraftController extends ChangeNotifier {
  AttachmentDraftController({
    required AttachmentPicker picker,
    required AttachmentUploader uploader,
    required FormErrorReporter onError,
  })  : _picker = picker,
        _uploader = uploader,
        _onError = onError;

  final AttachmentPicker _picker;
  final AttachmentUploader _uploader;
  final FormErrorReporter _onError;

  PickedAttachment? _draft;
  bool _uploading = false;
  String? _status;

  /// Guards `notifyListeners()` after the composer is gone.
  ///
  /// Not paranoia: an upload can still be in flight when the conversation is
  /// torn down, and [uploadDraft]'s `finally` runs regardless. Without this
  /// the notify that releases the send button would itself throw. Same guard,
  /// same reason, as `FormSubmitController`.
  bool _disposed = false;

  /// The file waiting to be sent, or `null` when there is none.
  PickedAttachment? get draft => _draft;

  /// Whether a file is waiting to be sent.
  ///
  /// Also the discriminator a caller uses to read [uploadDraft]'s `null` —
  /// see that method.
  bool get hasDraft => _draft != null;

  /// True while the bytes are going up.
  bool get isUploading => _uploading;

  /// **Whether a send may start right now.**
  ///
  /// This is the flag the composer's `submit(text)` must consult, and the
  /// only one this module offers for the purpose. `composer.ts` spells the
  /// same rule as `sendButton.disabled = !enabled || uploading || !hasContent`
  /// — the middle term is this getter.
  ///
  /// Why a send has to be blocked at all, given the upload happens inside it:
  /// a second Enter keypress, a double-tap on Send, or a quick-reply chip
  /// tapped while the first send is still uploading would each start a second
  /// upload of the same file and announce it twice. The composer is not
  /// disabled during an upload — the customer can keep typing — so the button
  /// being visually greyed is not by itself a guarantee.
  bool get canSend => !_uploading;

  /// The sentence currently shown under the composer, or `null` when there is
  /// nothing to say.
  ///
  /// Always plain and always written for a customer. The exception that
  /// caused it goes to the [FormErrorReporter] instead — it carries a stack,
  /// and a `PlatformException` from a file picker carries a channel name and
  /// sometimes a filesystem path. Same split `FormSubmitController.submitOnce`
  /// makes.
  String? get statusMessage => _status;

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  /// Clears the status line.
  void clearStatus() {
    if (_status == null) return;
    _status = null;
    _notify();
  }

  /// Asks the platform for a file and, if it can be sent, makes it the draft.
  ///
  /// ── Re-picking the SAME file must fire again ─────────────────────────
  ///
  /// The web bug this exists not to repeat: `<input type="file">` keeps its
  /// `value`, so choosing the same file a second time fires no `change` event
  /// and the second attempt is silent. `composer.ts` fixes it by resetting
  /// `fileInput.value = ''` the instant a pick lands.
  ///
  /// Dart has no sticky input, so the only way to reintroduce the bug is to
  /// write it deliberately — a `if (_draft == file) return`, an
  /// `identical()` check, or a `notifyListeners()` made conditional on the
  /// draft having changed. **None of those may be added here.** Every
  /// accepted pick replaces the draft and notifies unconditionally, and
  /// [PickedAttachment] is deliberately left without value equality so no
  /// future `==` can make such a guard look harmless.
  ///
  /// The concrete case: a customer sends a photo, the agent says it came
  /// through blurry, and they pick the very same file again. A dedupe here
  /// makes that second attempt do nothing at all.
  ///
  /// ── What is refused, and what is silent ──────────────────────────────
  ///
  /// A cancel resolves `null` and says nothing — backing out of the system
  /// picker is not a failure and does not deserve a sentence. Everything
  /// else that stops a file gets words: a nameless file
  /// ([kAttachmentUnnamedMessage]), an oversized one
  /// ([kAttachmentTooLargeMessage]), and a picker that threw
  /// ([kAttachmentPickFailedMessage]).
  ///
  /// The name check is the one T7 handed to this seam. See
  /// [kAttachmentUnnamedMessage] for what letting a blank one through
  /// actually costs.
  Future<void> pick() async {
    // `composer.ts`: `attachButton.disabled = !enabled || uploading`. Picking
    // mid-upload would replace the very file being uploaded, and the upload
    // would go on to announce the one the customer just discarded.
    if (_uploading) return;

    final PickedAttachment? file;
    try {
      file = await _picker();
    } catch (error, stackTrace) {
      // Caller-supplied code calling a platform channel: a denied permission,
      // an unregistered channel, a file that cannot be read. Same reasoning
      // `captureContactInfo` gives for catching around its geolocation probe.
      _fail(kAttachmentPickFailedMessage, error, stackTrace);
      return;
    }

    if (file == null) return;

    // Name before size: a nameless file is unsendable at any size, and
    // telling someone their file is too large when the real problem is its
    // name sends them to shrink a file that would still be refused.
    if (file.isUnnamed) {
      _show(kAttachmentUnnamedMessage);
      return;
    }
    if (file.isTooLarge) {
      _show(kAttachmentTooLargeMessage);
      return;
    }

    _draft = file;
    // Unconditional, and the status is cleared with it — a stale "too large"
    // sentence sitting above a file that was accepted is worse than no
    // sentence at all.
    _status = null;
    _notify();
  }

  /// Drops the pending file.
  ///
  /// A no-op while an upload is in flight: the bytes are already going up,
  /// and letting the chip disappear would leave the customer watching an
  /// attachment they believe they removed arrive in the transcript anyway.
  void clearDraft() {
    if (_uploading) return;
    if (_draft == null) return;
    _draft = null;
    _notify();
  }

  /// Uploads the pending file, if there is one, and resolves what the socket
  /// needs to announce it.
  ///
  /// Called from the composer's `submit`, before the text is sent.
  ///
  /// ── Three outcomes, and how a caller tells them apart ────────────────
  ///
  ///  * **Nothing to upload** — resolves `null`, [hasDraft] false. Send the
  ///    text as normal.
  ///  * **Uploaded** — resolves the metadata, draft cleared, [hasDraft]
  ///    false. Announce it alongside the text.
  ///  * **Failed** — resolves `null` with **[hasDraft] still true** and
  ///    [statusMessage] set. The caller must NOT send the text.
  ///
  /// So the caller's rule is one line: `if (controller.hasDraft) return;`
  /// after the await. [hasDraft] is not a flag encoding a result — it is the
  /// literal fact that a file is still sitting in the composer waiting to go.
  ///
  /// ── The draft survives every failure ─────────────────────────────────
  ///
  /// This is the one place this module deliberately diverges from
  /// `composer.ts`. There, `submit()` calls `clearAttachment()` BEFORE
  /// awaiting the upload, so a failed upload leaves the customer with a
  /// sentence and no file — they have to find it in their photo roll and
  /// choose it again to retry something that may well have been a dropped
  /// packet. The optimistic clear is right for the TEXT, because core's
  /// offline queue makes a send durable and re-showing it invites a duplicate
  /// (§9.6). It is wrong for the file, because nothing queues an upload:
  /// `uploadAttachment` retries nowhere, and if the bytes did not land there
  /// is no record of them anywhere but in this controller.
  ///
  /// Retry is therefore just pressing Send again. There is no separate retry
  /// affordance and no retry policy here — a client that re-issues an upload
  /// on the customer's behalf can put the same file in the bucket twice.
  ///
  /// ── Never throws ─────────────────────────────────────────────────────
  ///
  /// A failure becomes a sentence plus a report, not an exception the
  /// composer has to catch. `uploadAttachment` can raise a bare
  /// [ArgumentError] for a malformed non-empty `mimeType` rather than a
  /// `RestException`, so a caller switching over that sealed hierarchy would
  /// miss it and let it escape to the zone. Catching [Object] here is what
  /// makes the sealed-vs-unsealed distinction stop being the caller's
  /// problem.
  Future<AttachmentMetadata?> uploadDraft() async {
    // Re-entrancy. Nothing has failed, so deliberately no message: the first
    // upload is still running and telling the customer otherwise would be a
    // lie about their own file.
    if (_uploading) return null;

    final PickedAttachment? file = _draft;
    if (file == null) return null;

    _uploading = true;
    _status = null;
    _notify();

    try {
      final AttachmentMetadata attachment = await _uploader(file);
      _draft = null;
      return attachment;
    } catch (error, stackTrace) {
      // `_draft` deliberately untouched — see this method's doc.
      _status = kAttachmentUploadFailedMessage;
      _onError(error, stackTrace);
      return null;
    } finally {
      _uploading = false;
      _notify();
    }
  }

  void _show(String message) {
    _status = message;
    _notify();
  }

  void _fail(String message, Object error, StackTrace stackTrace) {
    _status = message;
    _onError(error, stackTrace);
    _notify();
  }
}
