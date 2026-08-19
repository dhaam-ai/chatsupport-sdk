// Drives the built widget in a real Chrome and asserts the things jsdom cannot.
//
//   node scripts/dev-server.mjs          # terminal 1 (needs examples/demo running)
//   node scripts/verify-browser.mjs      # terminal 2
//
// Chrome DevTools Protocol over the WebSocket that is built into Node 18+, and
// the Chrome that is already installed. No driver dependency, deliberately: a
// package this size should not add puppeteer to the repo's lockfile to run a
// check that three fetches and a socket can do.
//
// ── Why this exists at all, given 70 jsdom tests ────────────────────────
//
// It caught two defects the jsdom suite could not, and neither was obscure:
//
//   1. The host page's `* { font-family: … !important }` reached the whole
//      widget. `:host` rules lose to any outer-document rule matching the host
//      element, so the typographic reset had to move onto the shadow-tree
//      roots. jsdom has no cascade competition to lose.
//   2. Every presentation rendered off screen. The per-presentation offset
//      selector out-specified the open-state rule that was meant to clear it —
//      sidebar at left:1280 on a 1280px viewport. jsdom computes no layout, so
//      a geometry assertion there would have been vacuous.
//
// Anything provable without layout or a real cascade belongs in test/ instead.

const PORT = Number(process.env['CDP_PORT'] ?? 9333);
const ORIGIN = process.env['HARNESS_ORIGIN'] ?? 'http://localhost:4599';

const failures = [];
const check = (name, actual, predicate, expectation) => {
  const ok = predicate(actual);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${expectation}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures.push(name);
};

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { headers: { Host: 'localhost' } })).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error(`no page target on :${PORT} — start Chrome with --remote-debugging-port=${PORT}`);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${page.id}`);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
const jsErrors = [];
const consoleNoise = [];

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p.resolve(msg.result); }
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') jsErrors.push(msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    consoleNoise.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 120));
  }
});

const send = (method, params = {}) => {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve) => pending.set(msgId, { resolve }));
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.value;
};

await send('Runtime.enable');
await send('Page.enable');

async function load(mode, width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  await send('Page.navigate', { url: `${ORIGIN}/?mode=${mode}` });
  await new Promise((r) => setTimeout(r, 3500));
}

const probe = (body) => evaluate(`(() => {
  const host = document.querySelector('dh-chat-widget');
  const sh = host.shadowRoot;
  const panel = sh.querySelector('.dh-panel');
  const launcher = sh.querySelector('.dh-launcher');
  ${body}
})()`);

console.log('\nisolation (host page is deliberately hostile: * !important, max z-index)');
await load('bubble', 1280, 900);
const iso = await probe(`return {
  hostChildren: document.querySelectorAll('body > *:not(script)').length,
  ourNodesInLightDom: document.querySelectorAll('.dh-launcher, .dh-panel').length,
  headStyles: document.head.querySelectorAll('style').length,
  bodyInlineStyle: document.body.getAttribute('style'),
  launcherFont: getComputedStyle(launcher).fontFamily,
  panelFont: getComputedStyle(panel).fontFamily,
  hostButtonBg: getComputedStyle(document.getElementById('host-button')).backgroundColor,
  launcherBg: getComputedStyle(launcher).backgroundColor,
  inTopLayer: host.matches(':popover-open'),
  widgetWinsHitTest: (() => { const r = launcher.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return hit === host || host.contains(hit); })(),
};`);

// The host's font must NOT reach in. This is the regression that shipped once.
check('host typography does not cross into the shadow tree', iso.launcherFont, (v) => !/Comic/i.test(v), 'our own stack');
check('panel typography likewise', iso.panelFont, (v) => !/Comic/i.test(v), 'our own stack');
check('host CSS does not restyle our launcher', iso.launcherBg, (v) => v !== 'rgb(255, 105, 180)', 'our accent, not the host hotpink');
check('our CSS does not escape onto the host button', iso.hostButtonBg, (v) => v === 'rgb(255, 105, 180)', 'the host page unchanged');
check('no stylesheet injected into the host document', iso.headStyles, (v) => v === 1, '1 (the host page own)');
check('document.body style not mutated', iso.bodyInlineStyle, (v) => v === null, 'null');
check('nothing of ours reachable by host selectors', iso.ourNodesInLightDom, (v) => v === 0, '0');
check('promoted to the top layer', iso.inTopLayer, (v) => v === true, 'true');
check('beats a host z-index of 2147483647', iso.widgetWinsHitTest, (v) => v === true, 'true');

console.log('\npresentations (each must be ON screen when open)');
for (const [mode, w, h, expect] of [['bubble', 1280, 900, 'bubble'], ['sidebar', 1280, 900, 'sidebar'], ['auto', 390, 780, 'sheet'], ['auto', 1280, 900, 'bubble']]) {
  await load(mode, w, h);
  await evaluate(`document.querySelector('dh-chat-widget').shadowRoot.querySelector('.dh-launcher').click()`);
  await new Promise((r) => setTimeout(r, 700));
  const geo = await probe(`const r = panel.getBoundingClientRect(); return {
    presentation: host.getAttribute('data-presentation'),
    onScreen: r.left < innerWidth && r.right > 0 && r.top < innerHeight && r.bottom > 0,
    width: Math.round(r.width), height: Math.round(r.height),
    visibility: getComputedStyle(panel).visibility,
  };`);
  check(`${mode} @${w}x${h} resolves to ${expect}`, geo.presentation, (v) => v === expect, expect);
  check(`${mode} @${w}x${h} panel is on screen`, geo, (v) => v.onScreen && v.visibility === 'visible' && v.width > 100 && v.height > 100, 'a visible panel inside the viewport');
}

console.log('\nkeyboard and a11y');
await load('bubble', 1280, 900);
await evaluate(`document.querySelector('dh-chat-widget').shadowRoot.querySelector('.dh-launcher').click()`);
await new Promise((r) => setTimeout(r, 600));
const opened = await probe(`return {
  focus: sh.activeElement && sh.activeElement.className,
  expanded: launcher.getAttribute('aria-expanded'),
  modal: panel.getAttribute('aria-modal'),
  ariaHidden: panel.getAttribute('aria-hidden'),
};`);
check('focus moves into the composer', opened.focus, (v) => String(v).includes('dh-input'), 'dh-input');
check('launcher reports expanded', opened.expanded, (v) => v === 'true', 'true');
check('panel is a modal dialog while trapped', opened.modal, (v) => v === 'true', 'true');
check('panel leaves the a11y tree only when closed', opened.ariaHidden, (v) => v === null, 'absent while open');

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await new Promise((r) => setTimeout(r, 600));
const closed = await probe(`return { open: panel.getAttribute('data-open'), hidden: panel.getAttribute('aria-hidden') };`);
check('Escape closes', closed.open, (v) => v === 'false', 'false');
check('closed panel leaves the a11y tree', closed.hidden, (v) => v === 'true', 'true');

console.log('\nhost-page safety');
check('no uncaught exceptions', jsErrors, (v) => v.length === 0, 'none');
check('no console errors or warnings', consoleNoise, (v) => v.length === 0, 'none');

console.log(`\n${failures.length === 0 ? 'all browser checks passed' : `${failures.length} FAILED: ${failures.join(', ')}`}\n`);
ws.close();
process.exit(failures.length === 0 ? 0 : 1);
