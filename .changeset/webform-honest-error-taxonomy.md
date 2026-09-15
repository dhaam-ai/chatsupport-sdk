---
"@dhaam-ccrm/widget": patch
---

The web form no longer tells a visitor things the server did not do.

Three sentences on this surface were false, and each was false because it had
been checked against the layer that renders the form rather than the layer that
answers it.

- **A 404 no longer reads as "please check the highlighted field."**
  `errorFromResponse` treated every unhandled status below 500 as a validation
  disagreement, so a misaddressed `apiUrl`, a moved path prefix or a gateway
  that never reached chat-service all accused the visitor's input. Nothing they
  typed produced it and nothing they can type fixes it. 404 — and any other
  unlisted sub-500 status — is now `'unreachable'`, is not retryable, and says
  support cannot be reached from this page. A real `400 VALIDATION_FAILED`
  keeps its sentence and its `fieldErrors` focus.

- **The contact-rule refusal says what to add.** `400
  WEBFORM_EMAIL_REQUIRED` is the outcome-level refusal
  (`decideWebformOutcome` → `needs_email`), answered by `refuse(...)` with no
  `details.fieldErrors` at all — so the old sentence told a visitor to check a
  highlighted field while nothing was highlighted. It is now its own kind,
  names Email as the field to return to, and asks for an address.

- **Only email is ever promised, because only email can answer.** The intro
  read "We'll reply by phone." on a `'phone'` tenant and "We'll get back to
  you." on `'either'`, and the confirmation named whichever detail was given —
  "We'll reply to +447700900123." to a visitor nobody can ring. No phone
  destination exists: a ticket is the only thing this surface can reach
  (`decideWebformOutcome`'s standalone-surface rule), its ticket branch is
  guarded by `if (!input.hasEmail) return { kind: 'needs_email' }`, and
  `Channel.WEBFORM` has no reply egress. A phone-only submission is refused
  outright when the tenant's flags are known and terminated FAILED by the drain
  worker when they are not. The intro now names email under every rule, and the
  confirmation names the address only when an address was given.

The confirmation also stopped branching on `outcome`. The `'chat'` sentence
promised a session whose visitor provably cannot be reached, and C6 stopped
producing that verdict at all. Nothing now claims a ticket exists or that
anyone has read the message — `queued` means the destination is still
undecided, and the bot verdict answers `queued` naming no row.

**The `'either'` form stopped contradicting itself.** The hint above the two
boxes read "Enter an email address or a phone number — either one is enough."
directly under an intro promising an email reply — and `'either'` is
`contact_requirement`'s NOT NULL default, so this was the majority tenant. A
phone-only submission clears `assertContactRequirement` and is then refused
400 by `decideWebformOutcome` with no row written, so "either one is enough"
was false about the only thing that sentence decides: what to type. The
least-effort reading of it — type the phone, it is shorter — was the one that
got refused. The hint now names the email as what makes a reply possible and
the phone as additive, only Email's " (optional)" is unmade (Phone keeps its
mark, because nothing needs it), and the submit backstop checks the email
rather than the pair — so the form no longer posts a submission it already
knows the server will refuse.

That email rule does **not** depend on the pair surviving. A merchant on an
`'either'` tenant who marks their own "Phone number" field required has it
dropped as a duplicate, which promotes the built-in Phone — and the hint, the
label treatment and the submit check were all gated on the pair being intact,
so that one field switched off all three and the form posted the phone-only
submission they exist to stop. The email check now follows the server's rule
(`decideWebformOutcome` refuses a ticket with no address) rather than the
form's shape, and in the promoted state neither box is marked "(optional)",
because both really are required — the merchant needs the phone, the server
needs the email.

The confirmation subtitle no longer restates the heading. It read "Message
received." beneath a heading already reading "Message received", which stacked
as one stuttered line and was byte-identical when no address was given. The
heading owns "we have it"; the subtitle owns what happens next, and with no
address there is nothing true to add, so it is hidden rather than padded.

`visitorMessage` is now total at runtime, not only over the union. `switch`
had no `default`, and `WebformError` is a public export whose `kind` is only
as narrow as the caller's types — so an unrecognised kind returned
`undefined`, which the consumer wrote straight into `textContent` for the
visitor to read.

`403 CHANNEL_DISABLED` no longer says "Messaging is switched off for this
site." That code is answered for two situations, and one of them is PRD row 3,
where the web form is off and live chat is on and open — the sentence was shown
directly above a working chat button. It now says the form is no longer
available, which is true on both.
