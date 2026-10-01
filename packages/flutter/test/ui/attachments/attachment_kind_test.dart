// What kind of thing a RECEIVED attachment is, for drawing and announcing.
//
// Received `mediaType` is not normalized: the customer's own uploads pass
// through `dart_rest`'s `normalizeMediaType`, but an agent console message
// arrives carrying the S3 folder name (`images`, `videos`, `audio`,
// `documents`) on both the history read and the socket frame. These cases
// pin every spelling the transcript can actually receive.

import 'package:dhaam_chat/dhaam_chat.dart' show AttachmentMetadata;
import 'package:dhaam_chat_flutter/src/ui/attachments/attachment_kind.dart';
import 'package:flutter_test/flutter_test.dart';

AttachmentMetadata _attachment(String mediaType, {String mimeType = ''}) {
  return AttachmentMetadata(
    url: 'https://cdn.example.com/f',
    fileName: 'f',
    mimeType: mimeType,
    size: 1,
    mediaType: mediaType,
  );
}

void main() {
  group('attachmentKind — a recognized mediaType decides', () {
    test('the S3 folder names the agent console sends', () {
      expect(attachmentKind(_attachment('images')), 'IMAGE');
      expect(attachmentKind(_attachment('videos')), 'VIDEO');
      expect(attachmentKind(_attachment('audio')), 'AUDIO');
      expect(attachmentKind(_attachment('documents')), 'DOCUMENT');
    });

    test('the singular names, in any case', () {
      expect(attachmentKind(_attachment('IMAGE')), 'IMAGE');
      expect(attachmentKind(_attachment('Video')), 'VIDEO');
      expect(attachmentKind(_attachment('AUDIO')), 'AUDIO');
      expect(attachmentKind(_attachment('document')), 'DOCUMENT');
      expect(attachmentKind(_attachment(' Videos ')), 'VIDEO');
    });

    test('over a mimeType that says otherwise', () {
      // The server chose the folder; a second classifier must not overrule
      // it. Same rule as the bubble's "classifies by mediaType" case.
      expect(
        attachmentKind(_attachment('documents', mimeType: 'image/png')),
        'DOCUMENT',
      );
      expect(
        attachmentKind(_attachment('IMAGE', mimeType: 'video/mp4')),
        'IMAGE',
      );
    });
  });

  group('attachmentKind — an unrecognized mediaType falls back to the MIME',
      () {
    test('family prefix, in any case', () {
      expect(attachmentKind(_attachment('', mimeType: 'image/jpeg')), 'IMAGE');
      expect(
        attachmentKind(_attachment('FILE', mimeType: 'Video/MP4')),
        'VIDEO',
      );
      expect(
        attachmentKind(_attachment('voice', mimeType: 'audio/wav')),
        'AUDIO',
      );
    });

    test('and is DOCUMENT when neither names a media kind', () {
      expect(
        attachmentKind(_attachment('FILE', mimeType: 'application/pdf')),
        'DOCUMENT',
      );
      expect(attachmentKind(_attachment('???')), 'DOCUMENT');
    });
  });
}
