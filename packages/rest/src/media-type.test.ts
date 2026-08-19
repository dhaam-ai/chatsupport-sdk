import { describe, expect, it } from 'vitest';

import { normalizeMediaType } from './media-type.js';

describe('normalizeMediaType', () => {
  it.each([
    ['images', 'IMAGE'],
    ['videos', 'VIDEO'],
    ['audio', 'AUDIO'],
    ['documents', 'DOCUMENT'],
  ] as const)('maps the S3 folder %s to %s', (folder, expected) => {
    // These four are the only values s3-client's getMediaFolder can produce
    // (s3-client.ts:13-32, 38-44).
    expect(normalizeMediaType(folder)).toBe(expected);
  });

  it.each(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'] as const)(
    'passes an already-correct %s through unchanged',
    (name) => {
      expect(normalizeMediaType(name)).toBe(name);
    },
  );

  it.each([
    ['an unrecognized string', 'sticker'],
    ['an empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 4],
    ['an object', { mediaType: 'images' }],
  ])('falls back to DOCUMENT for %s', (_label, value) => {
    // Mirrors s3-client.ts:43's own fallback; core then degrades DOCUMENT to
    // FILE, so an unknown kind still sends rather than failing the upload.
    expect(normalizeMediaType(value)).toBe('DOCUMENT');
  });

  it('tolerates surrounding whitespace and mixed case', () => {
    expect(normalizeMediaType('  Images ')).toBe('IMAGE');
  });
});
