// @vitest-environment node
//
// `pnpm preview:cards` (scripts/preview-cards.mjs) writes an HTML file under
// the OS temp directory. It must never use a predictable shared path: another
// local user could pre-create or symlink a fixed name like
// /tmp/dh-rich-cards-preview.html. So each run gets a fresh `mkdtempSync`
// directory, and the file is written with flag 'wx' and mode 0o600.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const script = join(dirname(fileURLToPath(import.meta.url)), '../scripts/preview-cards.mjs');
const written: string[] = [];

function run(): string {
  const out = execFileSync(process.execPath, [script], { encoding: 'utf8' }).trim();
  written.push(out);
  return out;
}

afterAll(() => {
  for (const file of written) rmSync(dirname(file), { recursive: true, force: true });
});

describe('the rich-card preview page', () => {
  it('goes into a fresh private directory on every run', () => {
    const first = run();
    const second = run();

    expect(dirname(first)).not.toBe(dirname(second));
    for (const file of [first, second]) {
      expect(dirname(dirname(file))).toBe(tmpdir());
      expect(basename(dirname(file))).toMatch(/^dh-rich-cards-.{6}$/);
      // mkdtemp creates the directory 0o700; the file is the owner's alone.
      expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  }, 60_000);

  it('is a complete page with the cards inlined', () => {
    const page = readFileSync(written[0] ?? run(), 'utf8');
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('dh-card');
    // Nothing in the inlined bundle can close the script tag early.
    expect(page.match(/<\/script/gi)).toHaveLength(1);
  }, 60_000);
});
