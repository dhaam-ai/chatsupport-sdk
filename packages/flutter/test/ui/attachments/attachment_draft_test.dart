// The value half of the attachment module: the cap, the byte formatter, and
// the two predicates the controller refuses on.
//
// `packages/widget/test` has no attachment test file — the JS surface is
// exercised only through `composer.test.ts`'s send block, which never picks a
// file. These assertions are therefore written against `composer.ts` itself
// (`MAX_ATTACHMENT_BYTES`, `acceptFile`, `formatBytes`) rather than reproduced
// from a web test that does not exist.
//
// The formatter cases are the load-bearing ones: the "too large" sentence is
// built by interpolating it, so a formatter that drifts silently rewrites the
// only sentence a customer with an oversized file ever sees.

import 'dart:typed_data';

import 'package:dhaam_chat_flutter/dhaam_chat_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

PickedAttachment _file({
  String fileName = 'receipt.pdf',
  String mimeType = 'application/pdf',
  int size = 12,
}) {
  return PickedAttachment(
    fileName: fileName,
    mimeType: mimeType,
    bytes: Uint8List(size),
  );
}

void main() {
  group('kMaxAttachmentBytes', () {
    test('is 25 MiB, matching composer.ts', () {
      expect(kMaxAttachmentBytes, 25 * 1024 * 1024);
    });
  });

  group('formatAttachmentBytes', () {
    test('renders under a kibibyte as plain bytes', () {
      expect(formatAttachmentBytes(0), '0 B');
      expect(formatAttachmentBytes(1023), '1023 B');
    });

    test('renders kibibytes rounded to a whole number', () {
      expect(formatAttachmentBytes(1024), '1 KB');
      expect(formatAttachmentBytes(1536), '2 KB');
      expect(formatAttachmentBytes(1024 * 1024 - 1), '1024 KB');
    });

    test('renders mebibytes to one decimal place', () {
      expect(formatAttachmentBytes(1024 * 1024), '1.0 MB');
      expect(formatAttachmentBytes((1.44 * 1024 * 1024).round()), '1.4 MB');
      expect(formatAttachmentBytes(kMaxAttachmentBytes), '25.0 MB');
    });

    test('divides by 1024, not 1000 — the web client does', () {
      // A decimal formatter would call this 1.0 MB. Two clients disagreeing
      // about the size of one file is the bug this port exists to avoid.
      expect(formatAttachmentBytes(1000 * 1000), '977 KB');
    });
  });

  group('kAttachmentTooLargeMessage', () {
    test('names the limit, so the refusal is not just a "no"', () {
      expect(kAttachmentTooLargeMessage,
          'That file is too large. The limit is 25.0 MB.');
    });

    test('interpolates the cap rather than hardcoding a second copy of it', () {
      // Pinning the relationship, not the string: if the constant moves and
      // the sentence does not, this is what catches it.
      expect(
        kAttachmentTooLargeMessage,
        contains(formatAttachmentBytes(kMaxAttachmentBytes)),
      );
    });
  });

  group('PickedAttachment.isTooLarge', () {
    test('accepts a file exactly at the cap', () {
      // `>` not `>=` in composer.ts. A file of exactly 25 MiB is within a
      // 25 MiB limit, and an off-by-one here refuses a file the sentence
      // just told the customer was allowed.
      expect(_file(size: kMaxAttachmentBytes).isTooLarge, isFalse);
    });

    test('refuses one byte over the cap', () {
      expect(_file(size: kMaxAttachmentBytes + 1).isTooLarge, isTrue);
    });

    test('accepts an ordinary file', () {
      expect(_file(size: 4096).isTooLarge, isFalse);
    });
  });

  group('PickedAttachment.isUnnamed', () {
    test('is false for a real name', () {
      expect(_file(fileName: 'receipt.pdf').isUnnamed, isFalse);
    });

    test('is true for an empty name — T7 has no fallback for one', () {
      expect(_file(fileName: '').isUnnamed, isTrue);
    });

    test('is true for a name that is only whitespace', () {
      // Trimmed, because `uploadAttachment` would send "   " as a filename
      // and the route would echo it back as a usable one. A name made of
      // spaces is not a name.
      expect(_file(fileName: '   ').isUnnamed, isTrue);
      expect(_file(fileName: '\t\n').isUnnamed, isTrue);
    });
  });

  group('PickedAttachment.mimeType', () {
    test('keeps an empty type verbatim rather than substituting one', () {
      // The whole point of T7's absent-vs-wrong split. A fallback written on
      // this side turns a malformed type into a silent generic file.
      expect(_file(mimeType: '').mimeType, '');
    });

    test('keeps a malformed non-empty type verbatim too', () {
      // `uploadAttachment` raises ArgumentError on this — deliberately, so a
      // caller that mangled a type finds out. Normalising it here would
      // swallow that signal.
      expect(_file(mimeType: 'not a mime type').mimeType, 'not a mime type');
    });
  });

  group('PickedAttachment.displaySize', () {
    test('is the formatted byte count', () {
      expect(_file(size: 2048).displaySize, '2 KB');
    });
  });
}
