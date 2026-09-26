#!/usr/bin/env node
// Creates (or updates) and PUBLISHES the test flows on a chat console, so the
// SDK's flow features can be tried end to end without clicking flows together.
//
// Reads `test-flow.json` and every `flows/*.json` next to this script.
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
//   ONLY   Only the flow whose name contains this text (case-insensitive).
//   DRY    Set to 1 to print the flow names, touching nothing.
//
// Idempotent: a flow with the same name is UPDATED, never duplicated. Flows this
// script does not own are read but never modified. A flow whose JSON says
// `"enabled": false` is published but left switched off.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE ?? 'https://chat-support-dev.dhaamai.com/chat-services/api/v1').replace(/\/$/, '');
const TOKEN = process.env.ADMIN_TOKEN;
const DRY = process.env.DRY === '1';
const ONLY = process.env.ONLY?.toLowerCase();

const files = [
  join(HERE, 'test-flow.json'),
  ...readdirSync(join(HERE, 'flows'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(HERE, 'flows', f)),
];
const definitions = files
  .map((file) => JSON.parse(readFileSync(file, 'utf8')))
  .filter((flow) => ONLY === undefined || flow.name.toLowerCase().includes(ONLY));

if (DRY) {
  console.log('DRY RUN — nothing is sent. These flows would be created or updated:');
  for (const flow of definitions) {
    console.log(`  - ${flow.name}  [starts: ${flow.rules.trigger}${flow.rules.labels.length ? ` (${flow.rules.labels})` : ''}${flow.rules.phrases.length ? ` (${flow.rules.phrases})` : ''}${flow.rules.hours !== 'any' ? `, ${flow.rules.hours}` : ''}${flow.enabled ? '' : ', OFF'}]`);
  }
  process.exit(0);
}

if (!TOKEN) {
  console.error('ADMIN_TOKEN is not set. See the header of this file for how to get it.');
  process.exit(1);
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    // `content-type` only WITH a body: the server rejects a bodiless request that
    // claims to be JSON ("Body cannot be empty"), which is what publish is.
    headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
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

const start = (f) =>
  `${f.rules?.trigger}${f.rules?.labels?.length ? ` (${f.rules.labels.join(',')})` : ''}${
    f.rules?.phrases?.length ? ` (says: ${f.rules.phrases.join(', ')})` : ''
  }${f.rules?.hours && f.rules.hours !== 'any' ? `, ${f.rules.hours}` : ''}`;
const summarize = (f) => `${f.name}  [${f.status}${f.enabled ? ', on' : ', OFF'}]  starts: ${start(f)}`;

let failures = 0;
try {
  const listed = await call('GET', '/admin/flows');
  const existingFlows = listed.data ?? [];
  console.log(`Flows already on this console (${existingFlows.length}):`);
  for (const f of existingFlows) console.log(`  - ${summarize(f)}`);
  if (listed.meta?.engineEnabled === false) {
    console.warn('\n!! This server reports the flow engine is OFF (FLOWS_ENGINE_ENABLED). Published flows will not run.');
  }

  for (const flow of definitions) {
    console.log(`\n== ${flow.name}`);
    try {
      // Dry-run through the server's own interpreter: no side effects.
      const label = flow.rules.labels[0];
      const simulated = await call('POST', '/admin/flows/simulate', {
        rules: flow.rules,
        graph: flow.graph,
        state: null,
        input: { type: 'start' },
        env: { aiEnabled: false, page: label ? { label } : {}, deskOpen: flow.rules.hours !== 'open', aiOutcome: null },
      });
      const sim = simulated.data ?? {};
      for (const line of sim.transcript ?? []) {
        console.log(`   ${line.who}: ${line.text}${line.buttons ? `  [${line.buttons.map((b) => b.label).join(' | ')}]` : ''}`);
      }

      const existing = existingFlows.find((f) => f.name === flow.name);
      const saved = existing
        ? (await call('PUT', `/admin/flows/${existing.id}`, {
            description: flow.description,
            enabled: flow.enabled,
            rules: flow.rules,
            graph: flow.graph,
            expectedVersion: existing.version,
          })).data
        : (await call('POST', '/admin/flows', flow)).data;
      const published = (await call('POST', `/admin/flows/${saved.id}/publish`)).data;
      console.log(`   ${existing ? 'updated' : 'created'} + published: ${summarize(published)}  (version ${published.publishedVersion})`);
    } catch (error) {
      failures += 1;
      console.error(`   FAILED: ${error.message}`);
      if (error.details) console.error(JSON.stringify(error.details, null, 2).slice(0, 800));
    }
  }

  const after = (await call('GET', '/admin/flows')).data ?? [];
  const live = after.filter((f) => f.enabled && f.status === 'published');
  console.log(`\nLive now (${live.length}): a page flow beats a "chat opens" flow at session creation, and nothing`);
  console.log('interrupts a flow already running in a chat:');
  for (const f of live) console.log(`  - ${summarize(f)}`);
  const off = after.filter((f) => !f.enabled);
  if (off.length > 0) {
    console.log(`\nSwitched off (turn on in the console to test): ${off.map((f) => f.name).join(', ')}`);
  }
} catch (error) {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
}
process.exit(failures > 0 ? 1 : 0);
