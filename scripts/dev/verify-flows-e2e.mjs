#!/usr/bin/env node
// Plays a visitor through every test flow on a REAL chat-service, over the wire,
// the way the SDK does: a guest token, a hello carrying the page context,
// `flow_reply` taps, typed answers, and `context.update` when the "visitor"
// navigates. Each scenario prints what the bot said and PASS / FAIL per step.
//
//   PowerShell:  $env:PK = "dhp_live_..."; node scripts/dev/verify-flows-e2e.mjs
//   bash:        PK=dhp_live_... node scripts/dev/verify-flows-e2e.mjs
//
// PK is the PUBLISHABLE key (public by design; NEXT_PUBLIC_CHAT_PUBLISHABLE_KEY in
// the customer app's .env). No secret is used: guest tokens come from the
// customer app's own `/api/chat-token`.
//
// Options: ONLY=<text> runs the scenarios whose name contains it;
//          SKIP_TICKETS=1 skips the scenario that really creates a ticket;
//          TOKEN_URL, WS_URL override the defaults (customer app / dev chat-service).
//
// Side effects on that server, all test data: one guest chat per scenario (with
// bot messages), tags on those chats, several chats handed to the human queue,
// and one real ticket ("Payment failed at checkout") unless SKIP_TICKETS=1.
// Resolve or delete them in the inbox afterwards.

import { randomBytes, randomUUID } from 'node:crypto';

const PK = process.env.PK;
const TOKEN_URL = process.env.TOKEN_URL ?? 'https://dhaam-customer.dhaamai.com/api/chat-token';
const WS_URL = process.env.WS_URL ?? 'wss://chat-support-dev.dhaamai.com/chat-services/v2/ws';
const ONLY = process.env.ONLY?.toLowerCase();
const SKIP_TICKETS = process.env.SKIP_TICKETS === '1';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class StepFailure extends Error {}

/** One visitor: a guest identity, a socket, and the bot messages it has seen. */
class Visitor {
  bot = [];
  #cursor = 0;
  #acks = new Map();
  #ws;

  static async connect({ label }) {
    const guestId = `guest_${randomUUID()}`;
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: guestId }),
    });
    if (!response.ok) throw new StepFailure(`guest token: HTTP ${response.status}`);
    const { accessToken } = await response.json();

    const visitor = new Visitor();
    visitor.#ws = new WebSocket(WS_URL);
    visitor.#ws.onmessage = (event) => visitor.#onFrame(JSON.parse(String(event.data)));
    await new Promise((resolve, reject) => {
      visitor.#ws.onopen = resolve;
      visitor.#ws.onerror = () => reject(new StepFailure('socket error'));
    });
    visitor.#send('connection.hello', {
      token: accessToken,
      publishableKey: PK,
      protocolVersion: 1,
      ...(label === undefined ? {} : { context: { label, url: `https://dhaam-customer.dhaamai.com/${label}` } }),
    });
    await visitor.#waitFor(() => visitor.connected, 8000, 'the server did not accept the hello');
    return visitor;
  }

  connected = false;

  #onFrame(frame) {
    if (frame.t === 'connection.ack') this.connected = true;
    if (frame.t === 'ack') this.#acks.set(frame.ref, frame.d);
    if (frame.t === 'message.new' && frame.d?.senderType === 'BOT') this.bot.push(frame.d);
    if (frame.t === 'error') this.lastError = frame.d?.code;
  }

  #send(type, data) {
    const id = ulid();
    this.#ws.send(JSON.stringify({ v: 1, t: type, id, ts: Date.now(), d: data }));
    return id;
  }

  async #waitFor(predicate, ms, failure) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await sleep(120);
    }
    if (!predicate()) throw new StepFailure(failure);
  }

  /** The next bot message, in order, which must contain `text`. */
  async expect(text, ms = 12000) {
    await this.#waitFor(() => this.bot.length > this.#cursor, ms, `no bot message arrived (wanted "${text}")`);
    const message = this.bot[this.#cursor];
    this.#cursor += 1;
    if (!String(message.content).includes(text)) {
      throw new StepFailure(`wanted a message containing "${text}", got "${message.content}"`);
    }
    return message;
  }

  /** Taps a button of the most recent bot message that offers it, the way the SDK does. */
  async tap(label) {
    const source = [...this.bot].reverse().find((m) => m.metadata?.buttons?.some((b) => b.label === label));
    if (!source) throw new StepFailure(`no button "${label}" is on offer`);
    const button = source.metadata.buttons.find((b) => b.label === label);
    const flow = source.metadata.flow ?? {};
    const id = this.#send('message.send', {
      content: label,
      type: 'TEXT',
      metadata: { kind: 'flow_reply', runId: flow.runId, stepId: flow.stepId, buttonId: button.id },
    });
    await this.#waitFor(() => this.#acks.get(id)?.ok === true, 8000, `the server did not acknowledge tapping "${label}"`);
  }

  async say(text) {
    const id = this.#send('message.send', { content: text, type: 'TEXT' });
    await this.#waitFor(() => this.#acks.get(id)?.ok === true, 8000, `the server did not acknowledge "${text}"`);
  }

  /** The visitor navigates (a single-page app route change). */
  async navigate(label) {
    const id = this.#send('context.update', { label, url: `https://dhaam-customer.dhaamai.com/${label}` });
    await this.#waitFor(() => this.#acks.get(id)?.ok === true, 8000, `the server rejected context.update (${this.lastError ?? 'no ack'})`);
  }

  /** Anything the bot said that nobody consumed with `expect`. */
  get unread() {
    return this.bot.slice(this.#cursor).map((m) => m.content);
  }

  close() {
    this.#ws.close();
  }
}

// --- scenarios --------------------------------------------------------------
// `label` is the page the visitor is on when the chat opens; a scenario with no
// label opens on a page with no name (only the URL matters to the server).

const scenarios = [
  {
    name: 'SDK test flow (page: home): buttons, then a message, then the end',
    label: 'home',
    run: async (v) => {
      await v.expect('Hi! This is a test flow');
      await v.expect('What would you like to try?');
      await v.tap('Payment help');
      await v.expect('Payments sometimes fail');
      await v.expect("That's it");
    },
  },
  {
    name: 'SDK test flow: email question, a wrong answer, then a right one',
    label: 'home',
    run: async (v) => {
      await v.expect('Hi! This is a test flow');
      await v.expect('What would you like to try?');
      await v.tap('Track my order');
      const question = await v.expect('What email did you order with?');
      if (question.metadata?.input?.type !== 'email') throw new StepFailure('the question does not carry input.type = email');
      await v.say('not an email');
      await v.expect("doesn't look like an email");
      await v.say('tester@example.com');
      await v.expect('Thanks tester@example.com');
    },
  },
  {
    name: 'Checkout help (page: checkout): change address, text answer, tag, handoff',
    label: 'checkout',
    run: async (v) => {
      await v.expect('Stuck at checkout?');
      await v.tap('Change address');
      await v.expect("What's the new delivery address?");
      await v.say('12 MG Road, Pune');
      await v.expect("I've noted: 12 MG Road, Pune");
      await v.expect('Connecting you with our team');
    },
  },
  {
    name: 'Checkout help: payment failed, email, and a real ticket',
    label: 'checkout',
    skip: SKIP_TICKETS,
    run: async (v) => {
      await v.expect('Stuck at checkout?');
      await v.tap('Payment failed');
      await v.expect('Failed payments are never charged');
      await v.expect('What email did you order with?');
      await v.say('ticket-test@example.com');
      await v.expect("We've opened a ticket and will email you at ticket-test@example.com");
      await v.expect('Anything else?');
    },
  },
  {
    name: 'Where is my order (page: order): a check, a loop back, and two answers',
    label: 'order',
    run: async (v) => {
      await v.expect('Happy to check on your order');
      await v.expect("What's your order number?");
      await v.say('10482'); // a valid order shape, but no DH prefix: the check says no
      await v.expect("doesn't start with DH");
      await v.expect("What's your order number?");
      await v.say('DH-10482');
      await v.expect('And the email you ordered with?');
      await v.say('shopper@example.com');
      await v.expect("Thanks shopper@example.com. I'm checking order DH-10482");
      await v.expect('Anything else?');
    },
  },
  {
    name: 'Account help (page: account): a number question, a check',
    label: 'account',
    run: async (v) => {
      await v.expect('How can we help with your account?');
      await v.tap('My rewards');
      await v.expect('About how many reward points');
      await v.say('lots');
      await v.expect('Please type just a number');
      await v.say('250');
      await v.expect("I'll compare 250 with your balance");
      await v.expect('Anything else?');
    },
  },
  {
    name: 'Account help: nested buttons',
    label: 'account',
    run: async (v) => {
      await v.expect('How can we help with your account?');
      await v.tap('Delete my account');
      await v.expect('Deleting your account is permanent');
      await v.tap('No, keep it');
      await v.expect('Nothing has changed');
      await v.expect('Anything else?');
    },
  },
  {
    name: 'Product questions (page: product): a button answer',
    label: 'product',
    run: async (v) => {
      await v.expect('Questions about this item?');
      await v.tap('How fast is delivery?');
      await v.expect('Most orders arrive in 30-45 minutes');
      await v.expect('Anything else?');
    },
  },
  {
    name: 'Product questions: typing instead of tapping goes to the AI answer (or a person)',
    label: 'product',
    run: async (v) => {
      await v.expect('Questions about this item?');
      await v.say('does this contain nuts?');
      // With the AI assistant on this is an AI reply; with it off, the handoff.
      const reply = await v.expect('', 25000);
      console.log(`       (${/Connecting you/.test(reply.content) ? 'AI is off: handed to a person' : 'AI answered'}: "${String(reply.content).slice(0, 70)}")`);
    },
  },
  {
    name: 'Navigation: a visitor moves from home to checkout mid-chat and the checkout flow starts',
    label: 'home',
    run: async (v) => {
      await v.expect('Hi! This is a test flow');
      await v.expect('What would you like to try?');
      await v.tap('Payment help');
      await v.expect('Payments sometimes fail');
      await v.expect("That's it"); // the home flow has finished, so a new page may start another
      await v.navigate('checkout');
      await v.expect('Stuck at checkout?');
    },
  },
  {
    name: 'Refund request (says): typing "refund" starts it, after another flow has ended',
    label: 'product',
    run: async (v) => {
      await v.expect('Questions about this item?');
      await v.tap('Is it in stock?');
      await v.expect('Stock is shown on the item page');
      await v.expect('Anything else?'); // the page flow is over; a keyword may start a new one
      await v.say('I want a refund please');
      await v.expect("Sorry things didn't go well");
      await v.expect('What happened?');
      await v.tap('Item damaged');
      await v.expect('What phone number can we reach you on?');
      await v.say('abc');
      await v.expect('Please include the digits');
      await v.say('+91 98765 43210');
      await v.expect("We'll call you on +91 98765 43210");
      await v.expect('Connecting you with our team');
    },
  },
  {
    name: 'Refund request: the policy branch ends the flow',
    label: 'product',
    run: async (v) => {
      await v.expect('Questions about this item?');
      await v.tap('Is it in stock?');
      await v.expect('Stock is shown on the item page');
      await v.expect('Anything else?');
      await v.say('can I get my money back');
      await v.expect("Sorry things didn't go well");
      await v.expect('What happened?');
      await v.tap('Changed my mind');
      await v.expect('An order can be cancelled before it is prepared');
      await v.expect('Anything else?');
    },
  },
  {
    name: "A page with no flow: only the welcome flow answers (\"While we're closed\" is switched off)",
    label: 'somewhere-else',
    run: async (v) => {
      const first = await v.expect('');
      if (/We're closed right now/.test(first.content)) throw new StepFailure('the closed-hours flow ran although it is switched off');
      console.log(`       (first message: "${String(first.content).slice(0, 60)}")`);
    },
  },
];

// --- runner -----------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;

for (const scenario of scenarios.filter((s) => ONLY === undefined || s.name.toLowerCase().includes(ONLY))) {
  if (scenario.skip) {
    console.log(`SKIP  ${scenario.name}`);
    skipped += 1;
    continue;
  }
  let visitor;
  try {
    visitor = await Visitor.connect({ label: scenario.label });
    await scenario.run(visitor);
    console.log(`PASS  ${scenario.name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL  ${scenario.name}\n       ${error instanceof StepFailure ? error.message : error}`);
    if (visitor?.unread.length) console.log(`       still unread from the bot: ${JSON.stringify(visitor.unread)}`);
    failed += 1;
  } finally {
    visitor?.close();
  }
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}.`);
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 300);
