---
"@dhaam-ccrm/widget": minor
---

`mountForm` — the web form, standalone.

A second script-tag artifact, `dist/form.js`, that mounts the contact form on
any element with no chat widget behind it: no launcher, no panel, no socket, no
session, no token mint. Same publishable key and the same `POST /widget/webform`
contract as the in-widget form, so the two surfaces cannot disagree about what a
submission means.

Available as `window.DhaamForm.mount(target, options)` from the script tag and
as `mountForm` / `getMountedForm` / `readFormBoot` from the package. Importing
from the package installs no global and scans no document — those are properties
of the script-tag artifact, not of the module.

One form per element; mounting into a non-empty element appends rather than
clears, because a merchant's "or email us at…" fallback inside that element is
theirs. The form renders synchronously, so no upstream state can leave a blank
rectangle on a merchant's contact page.
