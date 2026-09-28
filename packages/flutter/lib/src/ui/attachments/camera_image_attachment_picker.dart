/// The real camera-backed [AttachmentPicker].
///
/// Kept beside the file picker because both produce the same
/// [PickedAttachment] shape and share the same controller refusals. The split
/// is still important: choosing Camera must open the camera, not the document
/// browser.
library;

import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';
import 'package:mime/mime.dart';

import 'attachment_draft.dart';

/// Opens the platform camera and returns the captured image as an attachment.
Future<PickedAttachment?> cameraImageAttachmentPicker() async {
  final XFile? image = await ImagePicker().pickImage(
    source: ImageSource.camera,
  );
  if (image == null) return null;

  final int size = await image.length();
  if (size > kMaxAttachmentBytes) {
    return PickedAttachment(
      fileName: image.name,
      mimeType: image.mimeType ?? lookupMimeType(image.name) ?? '',
      bytes: Uint8List(0),
      size: size,
    );
  }

  final bytes = await image.readAsBytes();
  return PickedAttachment(
    fileName: image.name,
    mimeType:
        image.mimeType ?? lookupMimeType(image.name, headerBytes: bytes) ?? '',
    bytes: bytes,
    size: size,
  );
}
