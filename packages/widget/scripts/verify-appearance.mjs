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

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: ORIGIN });
// The config fetch has a 2s grace; give it room to land and be applied.
await new Promise((r) => setTimeout(r, 5000));

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
check('theme pinned to the published light', seen.theme, (v) => v === 'light', 'light');
check('design stayed classic', seen.design, (v) => v === 'classic', 'classic');
check('corner radius is the published 20px', seen.panelRadius, (v) => String(v).startsWith('20px'), '20px');
check('font is the published Inter', seen.panelFont, (v) => /Inter/.test(String(v)), 'a stack led by Inter');
check('launcher carries its shadow', seen.launcherShadow, (v) => v && v !== 'none', 'a box-shadow');
check('offsets put it 20px off both edges', seen.launcherRect, (v) => v.right === 20 && v.bottom === 20, '{right:20,bottom:20}');
check('thread paints the crosshatch texture', seen.threadImage, (v) => /repeating-linear-gradient/.test(String(v)), 'repeating-linear-gradient layers');
check('thread base is the published colour', seen.threadColor, (v) => v === 'rgb(244, 244, 245)', 'rgb(244, 244, 245) — #f4f4f5');
check('avatar shows the published initial', seen.avatarText, (v) => v === 'D', 'D');
check('avatar is painted in the accent in force', seen.avatarBg, (v) => v === seen.launcherBg, 'the same accent the launcher uses');
check('branding is visible', seen.brandingHidden, (v) => v === false, 'false');
check('branding links to the published URL', seen.brandingHref, (v) => v === 'https://dhaam.com', 'https://dhaam.com');
check('branding shows the published text', seen.brandingLabel, (v) => v === 'Powered by Dhaam', 'Powered by Dhaam');
// `botDisplayName`, not `appearance.title`: a bot really is handling this
// conversation, and identity-header.ts's whole contract is that a PRESENT
// handler outranks the configured title. Seeing the title here would be the bug.
check('the handling bot’s name outranks the configured title', seen.title, (v) => v === 'Dhaam Assistant', 'Dhaam Assistant — the botDisplayName');

// The one that could not be proved in jsdom: the socket really connected, so
// `connected` is in force and the merchant's subtitle stands in for 'Online'.
check('the published subtitle replaced “Online”', seen.statusText, (v) => v === 'Typically replies in a few minutes', 'the merchant’s own line');
check('launcher glyph came from the icon library', seen.glyphKind, (v) => String(v).startsWith('svg'), 'an svg');

console.log(failures.length === 0 ? '\nall appearance checks passed' : `\n${failures.length} FAILED`);
ws.close();
process.exit(failures.length === 0 ? 0 : 1);
