// Normalizing `/upload`'s `mediaType` to the names core understands.
//
// The route returns s3-client's `mediaFolder` verbatim
// (`upload.routes.ts:173` ← `infrastructure/storage/s3-client.ts:13-32, 38-44`),
// which is an S3 sub-folder name: lowercase and plural — `images`, `videos`,
// `audio`, `documents`.
//
// Core's `messageTypeFor` (packages/core/src/messages/controller.ts:87-97)
// switches on `IMAGE | VIDEO | AUDIO` and defaults to `FILE`, so an unnormalized
// `images` fell through the default and every uploaded image was announced as a
// generic file attachment.
//
// The fix belongs here, not in core: core must not learn one backend's S3
// folder naming. This package is the seam that absorbs exactly this kind of
// wire drift.

/** Core's `MediaType` names — the vocabulary `messageTypeFor` reads. */
export type MediaTypeName = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

/**
 * Lowercased wire value → core's name.
 *
 * Both the plural S3 folder and the singular form are listed so an
 * already-correct `IMAGE` survives the round trip unchanged: the lookup is done
 * on the lowercased input, which turns `IMAGE` into `image`.
 */
const BY_WIRE_VALUE: Readonly<Record<string, MediaTypeName>> = {
  images: 'IMAGE',
  image: 'IMAGE',
  videos: 'VIDEO',
  video: 'VIDEO',
  audio: 'AUDIO',
  documents: 'DOCUMENT',
  document: 'DOCUMENT',
};

/**
 * Maps `/upload`'s `mediaType` onto a name core recognizes.
 *
 * Unrecognized input becomes `DOCUMENT` rather than throwing, mirroring
 * s3-client's own fallback for an unclassified MIME type (`s3-client.ts:43`).
 * Core then degrades `DOCUMENT` to `MessageType.FILE`, which controller.ts:83-84
 * documents as intentional — so an unknown media kind still sends, as a file.
 * An upload is not worth failing over a label.
 */
export function normalizeMediaType(value: unknown): MediaTypeName {
  if (typeof value !== 'string') return 'DOCUMENT';
  return BY_WIRE_VALUE[value.trim().toLowerCase()] ?? 'DOCUMENT';
}
