// Builds `dist/widget.js` — the self-contained script-tag artifact — and
// reports what a customer's page actually pays for it.
//
// This is a DIFFERENT build from tsup's, with opposite rules, which is why it
// is a separate script rather than a second tsup entry:
//
//   tsup's output is for bundler users. Core, js, and rest stay EXTERNAL, so
//   an app that already imports core carries one copy of it.
//
//   This output is for a `<script src>`. There is no bundler on the other end
//   to resolve an import, so everything is INLINED, and the format is IIFE
//   rather than ESM — a plain `<script>` tag cannot evaluate an ESM bundle,
//   and requiring `type="module"` would drop every browser that still needs
//   the nomodule path and complicate the one-line install the whole package
//   exists to offer.
//
// The gzipped number is the one that matters: every CDN serving this will
// compress it, so the raw byte count overstates the cost by roughly 3x. Both
// are printed so the ratio is visible.

import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { stripCssCommentsPlugin } from '../build/strip-css-comments.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(packageRoot, 'dist', 'widget.js');

// Resolved once, and through `realpath`, because everything `originOf` decides
// is decided by comparing against it. See the header on `originOf`.
const realPackageRoot = realPath(packageRoot);
// Declared up here rather than beside `packageNameOf`: the composition tables
// run at top level, before a `const` further down the file has initialised.
const packageNames = new Map();

mkdirSync(join(packageRoot, 'dist'), { recursive: true });

// Filled in by the plugin as it loads the stylesheet, so the report below can
// say what the strip is worth instead of leaving it as folklore.
let stripStats = null;

const result = await build({
  entryPoints: [join(packageRoot, 'src', 'embed.ts')],
  outfile,
  bundle: true,
  minify: true,
  // `minify` does NOT cover the stylesheet. `src/ui/styles.ts` holds the whole
  // sheet in a template literal, so its `/* … */` blocks are string data;
  // esbuild leaves them alone because deleting characters from a string would
  // change what the program means. This plugin knows they are CSS and removes
  // them before esbuild parses the module. Shared with tsup.config.ts — one
  // transform, two registrations.
  plugins: [
    stripCssCommentsPlugin({
      onStrip: (stats) => {
        stripStats = stats;
      },
    }),
  ],
  format: 'iife',
  // ES2020 rather than esnext: `??=`, optional chaining and private fields all
  // exist there, and it is the floor at which the WebSocket/MediaRecorder
  // stack this depends on is present anyway. Going lower would pull in
  // regenerator for no reachable browser.
  target: ['es2020'],
  platform: 'browser',
  // Sourcemap is separate rather than inline: inlining it would roughly treble
  // the file a customer's page downloads to serve a debugging need that only
  // arises when someone is already looking.
  sourcemap: 'linked',
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

const bytes = readFileSync(outfile);
const gzipped = gzipSync(bytes, { level: 9 });

console.log('');
console.log(`  dist/widget.js   ${fmt(bytes.length)} raw   ${fmt(gzipped.length)} gzip`);
console.log('');

// A build failure, not a review comment. 79 KiB — roughly 4.9 KB of headroom
// over the current baseline of 75,927 B gzip — enough to absorb an estimate
// that is off, not enough to absorb a second feature riding in on top of this
// one unnoticed.
//
// THIS NUMBER MOVED DOWN, from 92,160, and it is the first time it has moved
// in that direction. The reason is that a long-standing cost was RETIRED
// rather than paid: the stylesheet's CSS comments are string data (see the
// plugin above), so no minifier ever removed them and every visitor of every
// host page downloaded 134 blocks of developer prose. Stripping them at build
// time took this artifact from 320,918 B to 264,724 B raw, and from 95,661 B
// to 75,927 B gzip — a 19,734 B saving on the number that is actually
// downloaded. Those are the figures the comparison pass at the bottom of this
// file prints on every build (`19.3 KB gzip (93.4 KB without the strip)`),
// measured the way it measures them: one esbuild pass with the plugin removed
// and nothing else changed. That pass writes no sourcemap, so 35 B of the raw
// difference is an absent `sourceMappingURL` comment rather than prose.
//
// Leaving the ceiling at 92,160 would have left more than 16 KB of silent
// regression room where the old budget only ever allowed 6,263 B. That is not
// a budget, it is a formality, and it would have let the whole saving be
// spent again without anyone being told.
// Increased to 120 KiB (122,880 B) for dynamic header logo support,
// portal thread customer name & initial display, and header alignment.
// Increased to 124 KiB (126,976 B) for the staff (admin/outlet) Messages-list
// redesign, WhatsApp-style bubbles and the history loading spinner — ~600 B
// over the previous ceiling, almost all of it stylesheet.
// Increased to 128 KiB (131,072 B) for the out-of-hours bot-flow engine (step
// parser, step machine, flow view and its stylesheet), which is what "Collect a
// message" in the console's Behaviour settings promises and the widget used to
// ignore. Measured 126,987 B gzip on this build — 11 B over the old ceiling —
// so the new ceiling leaves ~4 KiB of headroom rather than a formality.
const WIDGET_GZIP_BUDGET = 131_072;
if (gzipped.length > WIDGET_GZIP_BUDGET) {
  console.error(
    `  ERROR: dist/widget.js is ${fmt(gzipped.length)} gzip, over the ${fmt(WIDGET_GZIP_BUDGET)} budget.`,
  );
  console.error('  Either trim the addition or raise WIDGET_GZIP_BUDGET with a reason, not silently.');
  console.log('');
  process.exitCode = 1;
}

// What dominates, by origin. A single "the bundle is N KB" number is not
// actionable; "core is two thirds of it" tells you where to look.
// The `.js` output specifically — `outputs` also holds the sourcemap entry,
// which has no `inputs` and would silently yield an empty table.
const jsOutput = Object.entries(result.metafile.outputs).find(([file]) => file.endsWith('.js'));
const inputs = jsOutput?.[1]?.inputs ?? {};
const groups = new Map();
for (const [file, meta] of Object.entries(inputs)) {
  groups.set(originOf(file), (groups.get(originOf(file)) ?? 0) + meta.bytesInOutput);
}
const total = [...groups.values()].reduce((sum, value) => sum + value, 0) || 1;
console.log('  composition (pre-minification source bytes reaching the bundle):');
for (const [origin, size] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
  const share = Math.round((size / total) * 100);
  console.log(`    ${String(share).padStart(3)}%  ${fmt(size).padStart(9)}  ${origin}`);
}
console.log('');

// Measure the three presentations' shared cost against a stripped build, so
// the report can say what the UI itself costs versus what the SDK under it
// does. Built into a scratch dir and thrown away.
const scratch = join(packageRoot, '.size-tmp');
try {
  mkdirSync(scratch, { recursive: true });
  const entry = join(scratch, 'core-only.ts');
  writeFileSync(entry, "export { createChatClient } from '@dhaam-ccrm/core';\n");
  const bare = await build({
    entryPoints: [entry],
    outfile: join(scratch, 'core-only.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020'],
    platform: 'browser',
    logLevel: 'silent',
  });
  void bare;
  const coreBytes = readFileSync(join(scratch, 'core-only.js'));
  const coreGzip = gzipSync(coreBytes, { level: 9 });
  console.log(`  of which @dhaam-ccrm/core alone: ${fmt(coreBytes.length)} raw   ${fmt(coreGzip.length)} gzip`);
  console.log(`  the widget's own UI adds:        ${fmt(bytes.length - coreBytes.length)} raw   ${fmt(gzipped.length - coreGzip.length)} gzip`);
  console.log('');

  // What the CSS-comment strip is worth, measured rather than asserted.
  //
  // The plugin can report the SOURCE bytes it removed for free, and that
  // number is the wrong one to publish on its own: comment prose is repetitive
  // English and gzip eats it, so quoting the raw saving overstates what a
  // visitor actually saves by roughly 3x — the same trap this file's header
  // warns about for the bundle as a whole. So this rebuilds once without the
  // plugin and compares the gzipped results. One extra esbuild pass, measured
  // at ~110ms against the ~14s tsup spends on .d.ts in the same `pnpm build`,
  // to keep a number honest that would otherwise be repeated from memory in a
  // comment and quietly drift away from the artifact.
  if (stripStats !== null) {
    await build({
      entryPoints: [join(packageRoot, 'src', 'embed.ts')],
      outfile: join(scratch, 'unstripped.js'),
      bundle: true,
      minify: true,
      format: 'iife',
      target: ['es2020'],
      platform: 'browser',
      logLevel: 'silent',
    });
    const unstripped = gzipSync(readFileSync(join(scratch, 'unstripped.js')), { level: 9 });
    console.log(
      `  css comments stripped from the stylesheet: ${stripStats.removed} blocks, ` +
        `${fmt(stripStats.bytesRemoved)} of source`,
    );
    console.log(
      `  which is worth: ${fmt(unstripped.length - gzipped.length)} gzip ` +
        `(${fmt(unstripped.length)} without the strip)`,
    );
    // Zero today. A comment with no whitespace on either side is the one shape
    // the transform declines to touch, because removing it would join two CSS
    // tokens — see build/strip-css-comments.mjs. Printed so it never becomes
    // invisible.
    if (stripStats.kept > 0) {
      console.log(`  left in place (no whitespace beside them, unsafe to remove): ${stripStats.kept}`);
    }
    console.log('');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ════════════════════════════════════════════════════════════════════════
// dist/form.js — the standalone web form, with no chat widget in it
// ════════════════════════════════════════════════════════════════════════
//
// A THIRD artifact with a third set of rules, and the reason it is separate
// from `dist/widget.js` rather than a flag on it is the number at the bottom
// of this block: the widget bundle is dominated by @dhaam-ccrm/core, and a
// contact form needs none of it. `src/form.ts` imports nothing from any
// sibling package, so this bundle contains no client, no store, no socket and
// no token provider — which is what lets it be roughly a tenth of the widget.
//
// ── The entry lives here, and that is deliberate ────────────────────────
//
// Auto-installing `window.DhaamForm` and scanning the document for mount
// targets is a property of THE SCRIPT-TAG ARTIFACT, not of the module. The
// npm package must not do either on import — a React app calling `mountForm`
// would get a global it never asked for and a document scan it cannot
// control. So the side effect is a three-line stdin entry, here, and
// everything it calls is exported from `src/form.ts` where tests can reach
// it (`test/mount-form.test.ts`).
const formOutfile = join(packageRoot, 'dist', 'form.js');

const formResult = await build({
  stdin: {
    contents: "import { installFormGlobal } from './src/form.ts';\ninstallFormGlobal();\n",
    resolveDir: packageRoot,
    // `form-entry.ts`, not `form-embed.ts`: the latter is now a real module
    // with its own bundle below, and a composition table naming this entry
    // after it would point at the wrong file.
    sourcefile: 'form-entry.ts',
    loader: 'ts',
  },
  outfile: formOutfile,
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  sourcemap: 'linked',
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

const formBytes = readFileSync(formOutfile);
const formGzip = gzipSync(formBytes, { level: 9 });

console.log(`  dist/form.js     ${fmt(formBytes.length)} raw   ${fmt(formGzip.length)} gzip`);
console.log('');

// A build failure, not a review comment — the same contract as
// WIDGET_GZIP_BUDGET above, sized for a much smaller artifact.
//
// 12 KiB against a measured 9,984 B gzip: 2,304 B of headroom. Measured
// 2026-09-14 by `formGzip` above, on this build, and stated ONCE — earlier
// drafts of this comment quoted three different numbers from three sources.
// To reproduce, after `pnpm build`, from `packages/widget`:
//
//   node -e "const {gzipSync}=require('node:zlib');const {readFileSync}=require('node:fs');\
//   const b=readFileSync('dist/form.js');console.log(b.length, gzipSync(b,{level:9}).length)"
//   → 24932 9984
//
// It read 24,369 / 9,738 when this budget was set, before the resize
// protocol's frame half (`parentOrigin`, `parentOriginFromLocation`) landed
// in form.ts: +563 raw, +246 gzip. The budget itself is unchanged — that is
// what the headroom was for.
//
// Chosen as a proportion of THIS bundle rather than by copying the widget's
// ~6%, which would be ~600 B here and would fail on a single added sentence
// of copy. It is enough to absorb the merchant's three `form` copy strings
// and a contact-requirement branch — the two things this file knowingly does
// not render yet.
//
// It is NOT the thing standing between this artifact and an accidental
// `import … from '@dhaam-ccrm/core'`. A size budget only catches an import
// that is big; the named guard at the bottom of this block is what catches
// one at any size, and it only started doing so once `originOf` stopped
// reading `../` as a package name.
const FORM_GZIP_BUDGET = 12_288;
if (formGzip.length > FORM_GZIP_BUDGET) {
  console.error(
    `  ERROR: dist/form.js is ${fmt(formGzip.length)} gzip, over the ${fmt(FORM_GZIP_BUDGET)} budget.`,
  );
  console.error('  Either trim the addition or raise FORM_GZIP_BUDGET with a reason, not silently.');
  console.log('');
  process.exitCode = 1;
}

// The composition table matters more here than for the widget: the whole
// claim being made about this artifact is what is NOT in it.
const formOutput = Object.entries(formResult.metafile.outputs).find(([file]) => file.endsWith('.js'));
const formInputs = formOutput?.[1]?.inputs ?? {};
const formGroups = new Map();
for (const [file, meta] of Object.entries(formInputs)) {
  formGroups.set(originOf(file), (formGroups.get(originOf(file)) ?? 0) + meta.bytesInOutput);
}
console.log('  dist/form.js composition:');
for (const [origin, size] of [...formGroups.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${fmt(size).padStart(9)}  ${origin}`);
}
// An ALLOWLIST, not a check for `@dhaam-ccrm/core` by name. Naming the thing
// you are afraid of means the guard is only as good as the label, and this
// one spent its whole life looking for `@dhaam-ccrm/core` while `originOf`
// was filing core under `@dhaam-ccrm/..` — a guard that could not fail. Two
// buckets are legitimate in this bundle; ANY third is the regression,
// whatever it ends up called, including `unknown origin`.
//
// It will also fail on a first `node_modules` dependency, deliberately: the
// claim this artifact makes is that it contains its own UI and nothing else,
// and a new dependency is a decision to make out loud rather than a number
// that drifts.
const FORM_ALLOWED_ORIGINS = new Set(['widget UI (src/ui)', 'widget wiring (src)']);
const strays = [...formGroups.keys()].filter((origin) => !FORM_ALLOWED_ORIGINS.has(origin));
if (strays.length > 0) {
  console.error(
    `  ERROR: ${strays.join(', ')} reached dist/form.js. The form has no client in it.`,
  );
  console.error('  Either drop the import or state here why this bundle now carries it.');
  process.exitCode = 1;
}
console.log('');

// ════════════════════════════════════════════════════════════════════════
// dist/form-embed.js — the iframe embed's HOST half, and nothing else
// ════════════════════════════════════════════════════════════════════════
//
// A FOURTH artifact. It runs on the merchant's own page, creates one
// `<iframe>` pointing at the console's hosted form page, and applies the
// heights that page posts up. It renders no form: the form is inside the
// frame, on another origin, served by `dist/form.js`'s module.
//
// So the claim this bundle makes is narrower than `dist/form.js`'s, and the
// allowlist below is correspondingly narrower — `src/ui` is a STRAY here. A
// merchant paying for a whole form's UI on a page that only holds an iframe
// would be paying for nothing, and the import that did it would be invisible
// in a size budget (the form UI is only ~16 KB of source) until someone read
// the table.
const embedOutfile = join(packageRoot, 'dist', 'form-embed.js');

const embedResult = await build({
  stdin: {
    contents: "import { installFormEmbedGlobal } from './src/form-embed.ts';\ninstallFormEmbedGlobal();\n",
    resolveDir: packageRoot,
    sourcefile: 'form-embed-entry.ts',
    loader: 'ts',
  },
  outfile: embedOutfile,
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  sourcemap: 'linked',
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

const embedBytes = readFileSync(embedOutfile);
const embedGzip = gzipSync(embedBytes, { level: 9 });

console.log(`  dist/form-embed.js   ${fmt(embedBytes.length)} raw   ${fmt(embedGzip.length)} gzip`);
console.log('');

// A build failure, not a review comment — the same contract as the two
// budgets above, sized for by far the smallest artifact of the four.
//
// 3 KiB against a measured 1,547 B gzip: 1,525 B of headroom, roughly the
// size of the file itself. Generous ON PURPOSE and stated as such: at this
// size a budget proportional to the others (~6%, i.e. 92 B) would fail on a
// single added comment block, and a budget that fails for no reason gets
// raised without being read.
//
// ── WHAT THIS PAIR OF GUARDS DOES NOT CATCH ─────────────────────────────
//
// An earlier draft of this comment justified that headroom by claiming "the
// smallest thing this file could accidentally import is larger than 1.6 KB".
// That is FALSE, and measuring it is cheap. Import and use `asksForAHuman`
// from `./handoff-keywords.js` — 4,319 B of source, a whole real module — and
// this script prints
//
//   dist/form-embed.js   3.7 KB raw   1.7 KB gzip     (3,781 / 1,781 exactly)
//   dist/form-embed.js composition:
//        3.6 KB  widget wiring (src)
//
// and exits 0. No budget error: ~240 B of gzip against ~1,525 of headroom. No
// allowlist error either, and that is the more interesting half — `originOf`
// buckets EVERY non-`src/ui` file under `packages/widget/src/` into the single
// allowed bucket, `'widget wiring (src)'`, so a sibling module is
// indistinguishable here from this file's own code.
//
// So state the real boundary instead. The two guards catch:
//
//   - @dhaam-ccrm/core, a workspace sibling, or anything from node_modules
//     (named buckets, any size);
//   - `src/ui/**` — the form UI landing on a page that only holds an iframe
//     (named bucket, any size);
//   - anything, from anywhere, that adds more than ~1.5 KB gzip.
//
// They do NOT catch a self-contained `src/*.ts` sibling under that size.
// `handoff-keywords.ts`, `attributes.ts` (5,972 B) and `singleton.ts`
// (2,262 B) are each in that class today. Closing it means bucketing per FILE
// rather than per directory, which changes `originOf` and therefore all three
// composition tables above — out of scope here, and written down rather than
// left as a reassurance that does not hold. A guard carrying a false claim is
// worse than one that states its limit, because the false claim is what stops
// the next person looking.
//
// Measured 2026-09-14 by `embedGzip` above, on this build. To reproduce,
// after `pnpm build`, from `packages/widget`:
//
//   node -e "const {gzipSync}=require('node:zlib');const {readFileSync}=require('node:fs');\
//   const b=readFileSync('dist/form-embed.js');console.log(b.length, gzipSync(b,{level:9}).length)"
//   → 3287 1547
//
// It read 3065 / 1435 before this round's additions — the `http:`/`https:`
// scheme test on `hostedOrigin` and the `onUnreachable` deadline: +222 raw,
// +112 gzip. The budget itself is unchanged.
const FORM_EMBED_GZIP_BUDGET = 3_072;
if (embedGzip.length > FORM_EMBED_GZIP_BUDGET) {
  console.error(
    `  ERROR: dist/form-embed.js is ${fmt(embedGzip.length)} gzip, over the ${fmt(FORM_EMBED_GZIP_BUDGET)} budget.`,
  );
  console.error('  Either trim the addition or raise FORM_EMBED_GZIP_BUDGET with a reason, not silently.');
  console.log('');
  process.exitCode = 1;
}

const embedOutput = Object.entries(embedResult.metafile.outputs).find(([file]) => file.endsWith('.js'));
const embedInputs = embedOutput?.[1]?.inputs ?? {};
const embedGroups = new Map();
for (const [file, meta] of Object.entries(embedInputs)) {
  embedGroups.set(originOf(file), (embedGroups.get(originOf(file)) ?? 0) + meta.bytesInOutput);
}
console.log('  dist/form-embed.js composition:');
for (const [origin, size] of [...embedGroups.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${fmt(size).padStart(9)}  ${origin}`);
}

// ONE bucket is legitimate here, against `dist/form.js`'s two. `src/ui` in
// this bundle means the form itself has been pulled onto the merchant's page
// — the exact thing the iframe surface exists to avoid — and
// `@dhaam-ccrm/core`, `node_modules` or `unknown origin` each mean this file
// stopped being the standalone, import-free module its header claims.
const FORM_EMBED_ALLOWED_ORIGINS = new Set(['widget wiring (src)']);
const embedStrays = [...embedGroups.keys()].filter((origin) => !FORM_EMBED_ALLOWED_ORIGINS.has(origin));
if (embedStrays.length > 0) {
  console.error(
    `  ERROR: ${embedStrays.join(', ')} reached dist/form-embed.js. It embeds a frame; it does not render a form.`,
  );
  console.error('  Either drop the import or state here why this bundle now carries it.');
  process.exitCode = 1;
}
console.log('');

function fmt(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

/** An absolute, symlink-resolved path, in `/` form. Never throws. */
function realPath(file) {
  const absolute = resolve(process.cwd(), file);
  let resolved = absolute;
  try {
    resolved = realpathSync(absolute);
  } catch {
    // esbuild's `stdin` input arrives under its `sourcefile` name, which is a
    // path that does not exist. Its `resolve`d form is still inside the
    // package, which is all the caller needs.
  }
  return resolved.split('\\').join('/');
}

/**
 * Groups a bundled input path by the package it came from.
 *
 * ── Why this normalises instead of reading the first path segment ────────
 *
 * esbuild's metafile keys are relative TO THE WORKING DIRECTORY, and "relative
 * to the working directory" is not a stable shape here. This repo's standing
 * rule is that a branch is a `git worktree`, and in a worktree `node_modules`
 * is a symlink into the main checkout — so `@dhaam-ccrm/core` resolves out of
 * the worktree entirely and arrives as
 * `../../../chatsupport-sdk/packages/core/dist/index.js`, not as the
 * `../core/dist/index.js` you get in the main checkout.
 *
 * Reading the first `../`-segment as a package name therefore produced
 * `@dhaam-ccrm/..`, and `formGroups.has('@dhaam-ccrm/core')` below — the guard
 * whose whole job is to fail the build if core reaches `dist/form.js` — was
 * false in every worktree, which is to say everywhere the work happens. Same
 * bug for anything under a root-level `node_modules`: `../../node_modules/x`
 * also captures `..`.
 *
 * So the path is resolved to ONE canonical absolute form first and the
 * question is then asked of that: which package directory is it in. The label
 * the guard matches and the label this table prints now come from the same
 * answer.
 */
function originOf(file) {
  const path = realPath(file);
  if (path.includes('/node_modules/')) return 'node_modules';
  if (path === realPackageRoot || path.startsWith(`${realPackageRoot}/`)) {
    const own = path.slice(realPackageRoot.length + 1);
    return own.startsWith('src/ui/') ? 'widget UI (src/ui)' : 'widget wiring (src)';
  }
  // A workspace sibling, wherever its checkout physically sits. Named by the
  // manifest that owns it rather than by its directory, so the string the
  // guard below matches is the string a developer would write in an import.
  return packageNameOf(path) ?? 'unknown origin';
}

/** The `name` from the nearest enclosing `package.json`, or `null`. */
function packageNameOf(path) {
  let dir = dirname(path);
  const seen = [];
  for (;;) {
    if (packageNames.has(dir)) break;
    seen.push(dir);
    let manifest = null;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      // No manifest here, or an unreadable one. Keep walking up.
    }
    if (manifest !== null && typeof manifest.name === 'string') {
      packageNames.set(dir, manifest.name);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      packageNames.set(dir, null);
      break;
    }
    dir = parent;
  }
  const name = packageNames.get(dir) ?? null;
  for (const cached of seen) packageNames.set(cached, name);
  return name;
}
