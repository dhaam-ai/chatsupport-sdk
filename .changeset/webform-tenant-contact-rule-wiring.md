---
"@dhaam-ccrm/widget": minor
---

Both visitor-facing web forms now render the tenant's own contact rule and
copy, instead of showing every tenant the same `'email'` form.

`ui/webform-form.ts` already took `contactRequirement` and `copy`. Nothing
passed them. A merchant could set "phone required" in the console and
chat-service enforced it on submit, while every visitor on every surface saw a
form that marked Email required and Phone "(optional)" — so a visitor who did
what the form asked was refused by the server, and a visitor who gave a phone
number was refused by the form.

- **The standalone form** (`mountForm`) applies what `GET /widget/form`
  answers: the contact rule AND the merchant's `title` / `intro` /
  `successMessage`, which were parsed and thrown away. It still renders
  synchronously with built-in strings — a blank rectangle on a contact page is
  the outcome that design is against — and reshapes itself when the read lands,
  keeping whatever is already in the boxes (a browser's autofill is instant;
  this read is not). A tenant on the server's default with no copy written
  renders once, as before.
- **The in-widget form** reads `data.form.contactRequirement` off
  `GET /widget/config`, published as `RemoteConfig.webformContactRequirement`.
  Both call sites are wired: the surface a visitor opens from Home, and the
  automatic one that stands in for the composer out of hours.

When the standalone form does reshape itself, the visitor keeps everything they
were holding: what is in the boxes, where focus was, a validation message they
are in the middle of being told, and the elapsed-fill timer the submit route
reads as a bot signal. That last one is not cosmetic — a timer restarted at the
reshape would put anyone who submits within two seconds of the read landing
under chat-service's `minFillMs` floor, where the route answers with a receipt
it never wrote a row for and the visitor is shown the merchant's own success
sentence. The rearrangement is also announced, so a screen-reader user is told
the form changed under them instead of meeting the new rule at submit.

**The fallback moved from `'email'` to `'either'`**, which is where the server
lands — `tenant_webform_config.contact_requirement`'s own NOT NULL DEFAULT, and
chat-service's `DEFAULT_CONTACT_REQUIREMENT`, applied at submit and on both
boot routes. `ui/webform-form.ts` names and exports it as
`DEFAULT_CONTACT_REQUIREMENT`, so both surfaces share one value rather than
two literals that have to be kept equal. An `'email'`
default was defensible only while nothing could override it; now that the real
value flows, an unreadable answer must land where the submit route will judge
it, and `'email'` demanded a detail the server does not require. A form built
with no rule named therefore renders the `'either'` shape — the pair hint above
both boxes, neither field marked — rather than the old email-required one.

`ContactRequirement` and `WebformCopy` are now exported from the package, from
`webform.ts`, the one module that defines them. `form.ts`'s structurally
identical `ContactRequirement` and `FormCopy` were a second declaration of the
same wire block; `FormCopy` is kept as an alias so nothing importing it breaks.
No public signature changes shape.
