// Reads what the widget ACTUALLY painted, in a real Chrome, from a real
// console publish — the half `verify-browser.mjs` does not cover, because it
// asserts isolation, geometry and a11y rather than appearance.
//
//   node scripts/dev-server.mjs          # terminal 1 (needs examples/demo running)
//   chrome --remote-debugging-port=9333  # terminal 2 (headless is fine)
//   node scripts/verify-appearance.mjs   # terminal 3
//
// Same CDP-over-built-in-WebSocket approach as its sibling, and the same
// no-driver-dependency reason.
//
// ── Why this is not a jsdom test ──────────────────────────────────────────
//
// Every assertion below reads a COMPUTED style or a laid-out rectangle, and
// most of the appearance work lands as CSS custom properties consumed by
// rules in a static stylesheet. jsdom computes no cascade and no layout, so
// asserting there proves the property was SET, never that anything was
// painted with it — the exact gap that let a launcher render off screen (see
// verify-browser.mjs's own header).
//
// It also runs against the LIVE endpoint rather than a fixture, so it covers
// the whole path the fixture test in test/console-parity.test.ts cannot:
// fetch, CORS, the 2s grace window, the merge, and the repaint.
//
// ── Reading a failure ─────────────────────────────────────────────────────
//
// The harness page states `data-accent` and `data-title` itself. Those two
// SHOULD show the host's values, not the console's — that is the host > remote
// precedence rule, and the checks below assert it in that direction on
// purpose. A failure there means precedence inverted, which is a real bug;
// everything else failing means a published field stopped reaching the paint.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env['CDP_PORT'] ?? 9333);
const ORIGIN = process.env['HARNESS_ORIGIN'] ?? 'http://localhost:4599';

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { headers: { Host: 'localhost' } })).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error(`no page target on :${PORT}`);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${page.id}`);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  const resolve = pending.get(msg.id);
  if (resolve) { pending.delete(msg.id); resolve(msg); }
});
const send = (method, params = {}) =>
  new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
};

// ── The expectations come from the LIVE config, not from constants ────────
//
// They used to be hardcoded ("design stayed classic", "Powered by Dhaam"), and
// every one of them went stale the first time somebody edited the console —
// five checks failed at once and not one of them was a defect. A verifier that
// cries wolf on a legitimate publish is a verifier people stop reading.
//
// So this asks the same endpoint the widget asks, and compares what was
// PUBLISHED against what was PAINTED. That is the property actually worth
// asserting, and it holds whatever the merchant does next.
const env = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), '..', '..', 'examples', 'demo', '.env'), 'utf8');
const publishableKey = /^CHAT_PUBLISHABLE_KEY=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
const apiUrl = (/^CHAT_API_URL=(.*)$/m.exec(env)?.[1]?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
const published = await fetch(`${apiUrl}/chat-services/api/v1/widget/config`, {
  headers: { 'X-Publishable-Key': publishableKey },
}).then((r) => r.json()).then((b) => b.data);
const appearance = published.appearance ?? {};
const behaviour = published.behaviour ?? {};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: ORIGIN });
// The config fetch has a 2s grace; give it room to land and be applied.
await new Promise((r) => setTimeout(r, 5000));

/** '#rrggbb' as the 'rgb(r, g, b)' getComputedStyle answers with. */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (m === null) return undefined;
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const failures = [];
const check = (name, actual, predicate, expectation) => {
  const ok = predicate(actual);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${expectation}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures.push(name);
};

// Open the panel so the header and thread are laid out and measurable.
await evaluate(`document.querySelector('dh-chat-widget').shadowRoot.querySelector('.dh-launcher').click()`);
await new Promise((r) => setTimeout(r, 700));

const seen = await evaluate(`(() => {
  const host = document.querySelector('dh-chat-widget');
  const sh = host.shadowRoot;
  const cs = (sel) => { const n = sh.querySelector(sel); return n ? getComputedStyle(n) : null; };
  const launcher = sh.querySelector('.dh-launcher');
  const panel = sh.querySelector('.dh-panel');
  const log = sh.querySelector('.dh-log');
  const avatar = sh.querySelector('.dh-avatar');
  const branding = sh.querySelector('.dh-branding');
  const brandingLink = sh.querySelector('.dh-branding-link');
  const glyph = sh.querySelector('.dh-launcher-emoji, .dh-launcher-image, .dh-launcher svg');
  return {
    accentVar: host.style.getPropertyValue('--dh-accent') || getComputedStyle(host).getPropertyValue('--dh-accent'),
    launcherBg: cs('.dh-launcher')?.backgroundColor,
    launcherShadow: cs('.dh-launcher')?.boxShadow,
    theme: host.getAttribute('data-theme'),
    design: host.getAttribute('data-design'),
    panelRadius: cs('.dh-panel')?.borderRadius,
    panelFont: cs('.dh-panel')?.fontFamily,
    threadImage: cs('.dh-log')?.backgroundImage,
    threadColor: cs('.dh-log')?.backgroundColor,
    avatarText: avatar ? avatar.textContent : null,
    avatarBg: avatar ? getComputedStyle(avatar).backgroundColor : null,
    brandingHidden: branding ? branding.hidden : 'no node',
    brandingHref: brandingLink && !brandingLink.hidden ? brandingLink.getAttribute('href') : null,
    brandingLabel: branding ? branding.textContent.trim() : null,
    statusText: sh.querySelector('.dh-status-text')?.textContent,
    title: sh.querySelector('.dh-title')?.textContent,
    glyphKind: glyph ? glyph.tagName.toLowerCase() + '.' + (glyph.getAttribute('class') || 'svg') : null,
    launcherRect: (() => { const r = launcher.getBoundingClientRect(); return { right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom) }; })(),
  };
})()`);

console.log('\nwhat the browser actually painted, from the live tenant-12775 publish\n');
console.log(JSON.stringify(seen, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
console.log('');

// The published row: accent #e11d48, theme light, design classic, radius 20,
// font Inter, thread pattern crosshatch on #f4f4f5, avatar "D", branding on
// with https://dhaam.com, launcher bubble at offset 20/20, icon library.
// The harness page states `data-accent="#0f766e"` and `data-title="Order
// support"` itself, so BOTH are host values the console must not overrule —
// remote's #e11d48 and "Dhaam Support" losing here is the precedence rule in
// remote-config.ts holding, not a field failing to arrive. Everything below
// that the host did NOT state is remote's, and that is what this file proves.
check('the host’s own accent survives a console publish', seen.launcherBg, (v) => v === 'rgb(15, 118, 110)', 'rgb(15, 118, 110) — the harness’s #0f766e, not remote’s #e11d48');
check('theme matches what was published', seen.theme, (v) => v === appearance.theme, String(appearance.theme));
check('design matches what was published', seen.design, (v) => v === (appearance.design ?? 'classic'), String(appearance.design ?? 'classic'));
check('corner radius is the published one', seen.panelRadius, (v) => String(v).startsWith(`${appearance.cornerRadius}px`), `${appearance.cornerRadius}px`);
check('font is the published one', seen.panelFont, (v) => String(v).includes(String(appearance.fontFamily)), `a stack led by ${appearance.fontFamily}`);
check('launcher carries its shadow', seen.launcherShadow, (v) => v && v !== 'none', 'a box-shadow');
// A `tab` launcher is EDGE-MOUNTED by definition — that is what makes it a
// tab rather than a floating bubble — so it ignores the horizontal offset on
// purpose. Asserting 20px there was asserting that a side tab is not a side
// tab.
if (appearance.launcher === 'tab') {
  check('the side tab sits flush to its edge', seen.launcherRect, (v) => v.right === 0, '{right:0}');
  check('the side tab still honours the vertical offset', seen.launcherRect, (v) => v.bottom === appearance.offsetY, `{bottom:${appearance.offsetY}}`);
} else {
  check('offsets match the published ones', seen.launcherRect, (v) => v.right === appearance.offsetX && v.bottom === appearance.offsetY, `{right:${appearance.offsetX},bottom:${appearance.offsetY}}`);
}
// What the backdrop paints with depends on its KIND, so the assertion has to
// as well. `mesh` deliberately defers to a palette token pair rather than to
// `thread.color` — it is the one backdrop needing different artwork per colour
// scheme — so comparing it against the merchant's colour asserts the opposite
// of what the code is documented to do.
const threadKind = appearance.thread?.background ?? 'solid';
if (threadKind === 'pattern') {
  check('thread paints the published texture', seen.threadImage, (v) => /gradient/.test(String(v)), `the ${appearance.thread?.pattern} texture`);
  check('thread base is the published colour', seen.threadColor, (v) => v === hexToRgb(appearance.thread?.color), String(appearance.thread?.color));
} else if (threadKind === 'mesh') {
  check('thread paints the mesh wash', seen.threadImage, (v) => /radial-gradient/.test(String(v)), 'four radial-gradient corners');
  check('thread base is the mesh token, not the merchant colour', seen.threadColor, (v) => v !== hexToRgb(appearance.thread?.color), 'the palette --dh-mesh-bg');
} else if (threadKind === 'image') {
  check('thread paints the artwork behind a scrim', seen.threadImage, (v) => /url\(/.test(String(v)), 'a url() layer');
} else {
  check('thread is the published flat colour', seen.threadColor, (v) => v === (hexToRgb(appearance.thread?.color) ?? v), String(appearance.thread?.color));
}
// The classic header's avatar is deliberately NOT drawn under the hero
// design — that layout has its own face row, and two avatars in one header is
// one more than anybody asked for. So what is asserted depends on the design.
if ((appearance.design ?? 'classic') === 'hero') {
  check('no classic avatar under the hero design', seen.avatarText, (v) => v === null, 'null — the hero header has its own faces');
} else {
  const initials = String(appearance.avatarInitials ?? '').trim().slice(0, 2);
  check('avatar shows the published initials', seen.avatarText, (v) => v === (initials === '' ? null : initials), initials || 'null');
  check('avatar is painted in the accent in force', seen.avatarBg, (v) => v === seen.launcherBg, 'the same accent the launcher uses');
}
check('branding is visible', seen.brandingHidden, (v) => v === false, 'false');
check('branding links to the published URL', seen.brandingHref, (v) => v === (appearance.brandingUrl ?? null), String(appearance.brandingUrl ?? 'null'));
check('branding shows the published text', seen.brandingLabel, (v) => v === appearance.brandingText, String(appearance.brandingText));
// `botDisplayName`, not `appearance.title`: a bot really is handling this
// conversation, and identity-header.ts's whole contract is that a PRESENT
// handler outranks the configured title. Seeing the title here would be the bug.
check('the handling bot’s name outranks the configured title', seen.title, (v) => v === published.botDisplayName, String(published.botDisplayName));

// The one that could not be proved in jsdom: the socket really connected, so
// `connected` is in force and the merchant's subtitle stands in for 'Online'.
check('the published subtitle replaced “Online”', seen.statusText, (v) => v === appearance.subtitle, String(appearance.subtitle));
check('launcher glyph came from the icon library', seen.glyphKind, (v) => String(v).startsWith('svg'), 'an svg');

console.log(failures.length === 0 ? '\nall appearance checks passed' : `\n${failures.length} FAILED`);
ws.close();
process.exit(failures.length === 0 ? 0 : 1);
