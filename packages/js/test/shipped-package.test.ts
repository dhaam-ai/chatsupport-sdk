// Regression guard: @dhaam-ccrm/core is fully bundled into every build
// output here (tsup noExternal + dts.resolve), so it must never appear as
// an external module specifier in what actually ships — otherwise a real
// external consumer's install (npm/yarn, not this pnpm workspace) breaks,
// since core is a devDependency-only, never-published workspace package.
// Found this exact bug once already: the .d.ts shipped a bare
// `export {...} from '@dhaam-ccrm/core'` before `dts: { resolve: true }`
// was added to tsup.config.ts.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');

describe('shipped package.json + dist', () => {
  it('does not list @dhaam-ccrm/core as a runtime dependency', () => {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@dhaam-ccrm/core']).toBeUndefined();
  });

  it('the shipped .d.ts never references @dhaam-ccrm/core as an external module', () => {
    for (const file of ['index.d.ts', 'index.d.cts']) {
      const content = readFileSync(join(distDir, file), 'utf8');
      expect(content, `${file} should not import/re-export from '@dhaam-ccrm/core'`).not.toMatch(/@dhaam-ccrm\/core/);
    }
  });

  it('the shipped JS never requires/imports @dhaam-ccrm/core at runtime', () => {
    for (const file of ['index.js', 'index.cjs', 'chat-sdk.global.js']) {
      const content = readFileSync(join(distDir, file), 'utf8');
      expect(content, `${file} should not reference '@dhaam-ccrm/core' at runtime`).not.toMatch(/@dhaam-ccrm\/core/);
    }
  });
});
