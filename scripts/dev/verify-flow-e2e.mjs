#!/usr/bin/env node
// Plays a visitor against a REAL chat-service, over the wire, the way the SDK
// does: mints a guest token, connects with a page context, and walks the "SDK
// test flow" — buttons, a flow_reply tap, the email question, the answer.
// Prints what the bot said and whether each step behaved; exits non-zero on the
// first thing that did not.
//
//   PowerShell:  $env:PK = "dhp_live_..."; node scripts/dev/verify-flow-e2e.mjs
//   bash:        PK=dhp_live_... node scripts/dev/verify-flow-e2e.mjs
//
// PK is the PUBLISHABLE key (public by design; NEXT_PUBLIC_CHAT_PUBLISHABLE_KEY
// in the customer app's .env). No secret is used: the guest token comes from the
// customer app's own `/api/chat-token`.
//
// Options: TOKEN_URL (default https://dhaam-customer.dhaamai.com/api/chat-token),
//          WS_URL (default wss://chat-support-dev.dhaamai.com/chat-services/v2/ws),
//          LABEL (page label sent on the hello, default "home"),
//          EMAIL (the answer to the email question, default tester@example.com).
//
// It creates a real guest session on that server (a "Guest" contact and a chat
// with a few bot messages); resolve it in the inbox afterwards if you care.

import { randomBytes, randomUUID } from 'node:crypto';

const PK = process.env.PK;
const TOKEN_URL = process.env.TOKEN_URL ?? 'https://dhaam-customer.dhaamai.com/api/chat-token';
const WS_URL = process.env.WS_URL ?? 'wss://chat-support-dev.dhaamai.com/chat-services/v2/ws';
const LABEL = process.env.LABEL ?? 'home';
const EMAIL = process.env.EMAIL ?? 'tester@example.com';

if (!PK) {
  console.error('PK (the publishable key, dhp_live_...) is not set.');
  process.exit(1);
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i += 1) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let tail = '';
  for (let i = 0; i < 16; i += 1) tail += ALPHABET[rnd[i] % 32];
  return time + tail;
}
const frame = (t, d) => ({ v: 1, t, id: ulid(), ts: Date.now(), d });

let failed = false;
const check = (ok, what) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};

// --- token ---------------------------------------------------------------
const guestId = `guest_${randomUUID()}`;
const tokenResponse = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ userId: guestId }),
});
console.log(`guest token: HTTP ${tokenResponse.status}`);
if (!tokenResponse.ok) process.exit(1);
const { accessToken } = await tokenResponse.json();

// --- connect -------------------------------------------------------------
const botMessages = [];
const acks = new Map();
let seenAck = false;
const ws = new WebSocket(WS_URL);
const send = (t, d) => {
  const f = frame(t, d);
  ws.send(JSON.stringify(f));
  return f.id;
};

ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.t === 'connection.ack') seenAck = true;
  if (msg.t === 'ack') acks.set(msg.ref, msg.d);
  if (msg.t === 'message.new' && msg.d?.senderType === 'BOT') botMessages.push(msg.d);
  if (msg.t === 'error') console.log(`  server error frame: ${msg.d?.code}`);
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('socket error'));
});
send('connection.hello', {
  token: accessToken,
  publishableKey: PK,
  protocolVersion: 1,
  context: { label: LABEL, url: `https://dhaam-customer.dhaamai.com/${LABEL}` },
});

const until = async (predicate, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return predicate();
};

console.log('\n1. Connect with page context and the flow starts');
check(await until(() => seenAck), 'server accepted the hello (with context)');
const first = await until(() => botMessages.some((m) => m.metadata?.buttons?.length));
check(first, 'a bot message arrived with buttons');
const withButtons = botMessages.find((m) => m.metadata?.buttons?.length);
if (!withButtons) {
  console.log('\nBot messages seen:', botMessages.map((m) => m.content));
  console.log('The flow did not start. Is it published and enabled, and does its page label match?');
  ws.close();
  process.exit(1);
}
console.log(`     bot: "${withButtons.content}"`);
console.log(`     buttons: ${withButtons.metadata.buttons.map((b) => b.label).join(' | ')}`);
check(withButtons.metadata.flow?.runId && withButtons.metadata.flow?.stepId, 'message carries metadata.flow {runId, stepId}');
check(Array.isArray(withButtons.metadata.options), 'options duplicate the labels (older SDKs render them as chips)');

console.log('\n2. Tap the first button the way the SDK does (flow_reply)');
const button = withButtons.metadata.buttons[0];
const countBefore = botMessages.length;
const tapId = send('message.send', {
  content: button.label,
  type: 'TEXT',
  metadata: { kind: 'flow_reply', runId: withButtons.metadata.flow.runId, stepId: withButtons.metadata.flow.stepId, buttonId: button.id },
});
check(await until(() => acks.get(tapId)?.ok === true), `server acknowledged the tap "${button.label}"`);
check(await until(() => botMessages.length > countBefore), 'the flow answered the tap');
const answer = botMessages[botMessages.length - 1];
console.log(`     bot: "${answer?.content}"`);
const wantsEmail = answer?.metadata?.input?.type === 'email';
check(true, `next step: ${answer?.metadata?.flow?.kind ?? 'unknown'}${wantsEmail ? ' (asks for an email: input hint = email)' : ''}`);

if (wantsEmail) {
  console.log('\n3. Answer the email question');
  const before = botMessages.length;
  send('message.send', { content: EMAIL, type: 'TEXT' });
  check(await until(() => botMessages.length > before), 'the flow continued after the answer');
  const last = botMessages[botMessages.length - 1];
  console.log(`     bot: "${last?.content}"`);
  check(String(last?.content).includes(EMAIL), 'the saved answer was used in the next message ({Email})');
}

ws.close();
console.log(failed ? '\nSome checks FAILED.' : '\nAll checks passed.');
setTimeout(() => process.exit(failed ? 1 : 0), 300);
