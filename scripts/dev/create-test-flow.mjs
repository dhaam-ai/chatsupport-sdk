#!/usr/bin/env node
// Creates (or updates) and PUBLISHES the "SDK test flow" on a chat console, so
// the SDK's flow features can be tried end to end without clicking a flow
// together by hand.
//
//   PowerShell:  $env:ADMIN_TOKEN = "<paste here>"; node scripts/dev/create-test-flow.mjs
//   bash:        ADMIN_TOKEN=<paste here> node scripts/dev/create-test-flow.mjs
//
// ADMIN_TOKEN is the staff login token of the console, read from the ENVIRONMENT
// only: it is never printed, logged or written anywhere by this script. Get it
// from the console in the browser: DevTools -> Network -> click any request to
// `/chat-services/api/v1/admin/...` -> Request Headers -> `authorization:
// Bearer <token>` (copy what follows "Bearer "). It expires after about an hour.
// Do not paste it into a chat or a ticket.
//
// Options (environment variables):
//   BASE   API prefix. Default: https://chat-support-dev.dhaamai.com/chat-services/api/v1
//   LABEL  Page label the flow starts on. Default: from test-flow.json ("home")
//   DRY    Set to 1 to print what would be sent, touching nothing.
//
// Idempotent: a flow with the same name is UPDATED, never duplicated. Other
// flows are read but never modified.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE ?? 'https://chat-support-dev.dhaamai.com/chat-services/api/v1').replace(/\/$/, '');
const TOKEN = process.env.ADMIN_TOKEN;
const DRY = process.env.DRY === '1';

const flow = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'test-flow.json'), 'utf8'));
if (process.env.LABEL) flow.rules.labels = [process.env.LABEL.trim().toLowerCase()];

if (DRY) {
  console.log('DRY RUN — nothing is sent. The flow would be:\n');
  console.log(JSON.stringify(flow, null, 2));
  process.exit(0);
}

if (!TOKEN) {
  console.error('ADMIN_TOKEN is not set. See the header of this file for how to get it.');
  process.exit(1);
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!response.ok) {
    const code = json?.error?.code ?? response.status;
    const message = json?.error?.message ?? json?.raw ?? '';
    const error = new Error(`${method} ${path} -> ${response.status} ${code} ${message}`);
    error.details = json?.error?.details;
    throw error;
  }
  return json;
}

const summarize = (f) =>
  `${f.name}  [${f.status}${f.enabled ? ', on' : ', OFF'}]  starts: ${f.rules?.trigger}${
    f.rules?.labels?.length ? ` (${f.rules.labels.join(',')})` : ''
  }`;

try {
  // 1. What is on this console already (read only).
  const listed = await call('GET', '/admin/flows');
  const flows = listed.data ?? [];
  console.log(`Existing flows (${flows.length}):`);
  for (const f of flows) console.log(`  - ${summarize(f)}`);
  if (listed.meta?.engineEnabled === false) {
    console.warn('\n!! This server reports the flow engine is OFF (FLOWS_ENGINE_ENABLED). Published flows will not run.');
  }

  // 2. Dry-run through the server's own interpreter: no side effects.
  const simulated = await call('POST', '/admin/flows/simulate', {
    rules: flow.rules,
    graph: flow.graph,
    state: null,
    input: { type: 'start' },
    env: { aiEnabled: false, page: { label: flow.rules.labels[0] }, deskOpen: true, aiOutcome: null },
  });
  const sim = simulated.data ?? {};
  console.log(`\nSimulation: starts here = ${sim.startsHere}${sim.whyNot ? ` (${sim.whyNot})` : ''}`);
  for (const line of sim.transcript ?? []) {
    console.log(`  ${line.who}: ${line.text}${line.buttons ? `  [${line.buttons.map((b) => b.label).join(' | ')}]` : ''}`);
  }

  // 3. Create, or update the same-named flow.
  const existing = flows.find((f) => f.name === flow.name);
  let saved;
  if (existing) {
    saved = (await call('PUT', `/admin/flows/${existing.id}`, {
      description: flow.description,
      enabled: flow.enabled,
      rules: flow.rules,
      graph: flow.graph,
      expectedVersion: existing.version,
    })).data;
    console.log(`\nUpdated existing flow ${saved.id}`);
  } else {
    saved = (await call('POST', '/admin/flows', flow)).data;
    console.log(`\nCreated flow ${saved.id}`);
  }

  // 4. Publish. Only errors block it; the server says exactly which.
  const published = (await call('POST', `/admin/flows/${saved.id}/publish`)).data;
  console.log(`Published: ${summarize(published)}  (version ${published.publishedVersion})`);

  // 5. Say what else will compete with it, since that is the usual reason a
  //    flow "does not start".
  const rivals = flows.filter((f) => f.id !== saved.id && f.enabled && f.status === 'published');
  if (rivals.length > 0) {
    console.log('\nOther live flows on this console (a page flow beats a "chat opens" flow at session creation,');
    console.log('but nothing interrupts a flow that is already running in a chat):');
    for (const f of rivals) console.log(`  - ${summarize(f)}`);
  }
  console.log(`\nDone. Try it: new guest, open the widget on the "${flow.rules.labels[0]}" page.`);
} catch (error) {
  console.error(`\nFailed: ${error.message}`);
  if (error.details) console.error(JSON.stringify(error.details, null, 2).slice(0, 1500));
  process.exit(1);
}
