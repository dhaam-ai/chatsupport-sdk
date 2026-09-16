// @vitest-environment jsdom
//
// WHICH DESTINATION a web-form submission asks for — the `prefer` key on the
// draft, or its deliberate absence.
//
// ── Why this is a boundary worth its own file ────────────────────────────
//
// `prefer` decides whether a submission becomes a conversation in the Inbox or
// a ticket, and NOTHING on either screen shows which was asked for. A form that
// sends the wrong one is invisible until somebody notices their contact page
// has never once produced a chat — which is exactly how it was found.
//
// The two surfaces share `createWebformForm` and must NOT agree here:
//
//   in-widget   sends `prefer: 'ticket'`. Correct, because the widget offers
//               chat by a different route entirely: "Try live chat anyway"
//               calls `onChooseChat` and never submits through this form. The
//               visitor who submits here chose to leave a message.
//
//   standalone  sends NOTHING. `src/form.ts` has no socket, no launcher and no
//               chat button (`alternative: null`), so a hardcoded `'ticket'`
//               would not be recording a choice — it would be the only outcome
//               that surface can produce. Omitted, the server's decision table
//               picks from the tenant's OWN channel settings and hours.
//
// Verified against the live database before this was written: on tenant 12775,
// every submission carrying `prefer: 'ticket'` became a ticket regardless of
// hours, and the only three that became `channel = 6` Inbox sessions were the
// three that carried no `prefer` at all.
//
// The assertions test the DRAFT the form hands to `onSubmit`, not the option
// passed in — an option that never reaches the wire is the failure mode here.

import { describe, expect, it } from 'vitest';

import { createWebformForm } from '../src/ui/webform-form.js';
import type { WebformDraft, WebformReceipt } from '../src/webform.js';

const receipt: WebformReceipt = { outcome: 'ticket', receiptId: 'r1', duplicate: false };

const $ = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};

/** Lets the submit handler's promise chain settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

/**
 * Mounts the form with `options.prefer` as given, submits it, and returns the
 * draft that reached `onSubmit`.
 *
 * `prefer` is passed through a spread rather than as a plain property so that
 * "the option was not supplied at all" is a case this helper can express. That
 * is the in-widget case and it is NOT the same as passing `undefined` through
 * an exactOptionalPropertyTypes boundary.
 */
async function draftFor(
  prefer?: { readonly prefer: 'ticket' | null },
): Promise<WebformDraft> {
  let captured: WebformDraft | undefined;
  const view = createWebformForm(
    {
      alternative: null,
      hours: 'OPEN',
      source: 'published',
      extraFields: [],
      contactRequirement: 'email',
      ...(prefer ?? {}),
    },
    {
      onSubmit: async (draft) => {
        captured = draft;
        return receipt;
      },
      onError: () => {},
    },
  );
  document.body.innerHTML = '';
  document.body.appendChild(view.node);

  $<HTMLInputElement>('#dh-webform-email').value = 'ada@example.com';
  $<HTMLTextAreaElement>('#dh-webform-message').value = 'Where is my order?';
  $<HTMLFormElement>('form').requestSubmit();
  await flush();

  if (captured === undefined) throw new Error('the form never submitted');
  return captured;
}

describe('webform `prefer` — which destination each surface asks for', () => {
  it('sends `ticket` when the option is not supplied at all (the in-widget case)', async () => {
    const draft = await draftFor();
    expect(draft.prefer).toBe('ticket');
  });

  it('omits the key entirely for `null` (the standalone case)', async () => {
    const draft = await draftFor({ prefer: null });
    // ABSENT, not `null` and not `''`. The route's schema treats a present key
    // as an answer, so a null would be the form asserting "no preference" as a
    // value rather than declining to express one — and `webform-decision.ts`
    // branches on `input.prefer !== undefined`.
    expect('prefer' in draft).toBe(false);
  });

  it('still sends `ticket` when asked for explicitly', async () => {
    const draft = await draftFor({ prefer: 'ticket' });
    expect(draft.prefer).toBe('ticket');
  });

  it('does not fold `null` into the default', async () => {
    // The one-line regression guard for `??`, which would read `null` as
    // "unset" and silently restore the hardcode this file exists to prevent.
    const [omitted, nulled] = await Promise.all([draftFor(), draftFor({ prefer: null })]);
    expect(omitted.prefer).toBe('ticket');
    expect(nulled.prefer).toBeUndefined();
  });
});
