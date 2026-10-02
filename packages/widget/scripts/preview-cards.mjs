// Builds a static page showing the bot's rich cards (metadata.richCards) as
// the widget draws them, so they can be looked at without a chat-service:
//
//   pnpm --filter @dhaam-ccrm/widget preview:cards     # prints the file path
//   open "$(pnpm --silent --filter @dhaam-ccrm/widget preview:cards)"
//
// Then add `?theme=dark` or `?accent=%23be123c` to the URL. The fixture
// messages are in scripts/preview-cards.entry.ts. Needs the workspace built
// once (`@dhaam-ccrm/core` resolves to its dist).
//
// Each run writes into a NEW private directory under the OS temp directory
// (`mkdtempSync`, so the name is unpredictable and the directory is the
// caller's alone), with flag 'wx' (fail rather than follow or overwrite
// anything already at that path) and mode 0o600. A fixed shared name like
// /tmp/preview.html could be pre-created or symlinked by another local user.
// Nothing is written into the package, so nothing generated is committed or
// published.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [join(here, 'preview-cards.entry.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  logLevel: 'warning',
});

// Inlined, so the page is one file that opens from disk. `</script` inside the
// bundle would end the tag early; escaping the slash is inert in JavaScript.
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const out = join(mkdtempSync(join(tmpdir(), 'dh-rich-cards-')), 'preview.html');
writeFileSync(
  out,
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rich cards preview</title></head>
<body style="margin:0;min-height:100vh;background:#d1d5db"><script>${js}</script></body>
</html>
`,
  { flag: 'wx', mode: 0o600 },
);
console.log(out);
