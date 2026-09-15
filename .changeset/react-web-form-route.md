---
"@dhaam-ccrm/react": minor
---

**`<DhaamForm />` — the web form at a route of your own.**

Mount the standalone web form wherever your router puts it:

```tsx
<Route path="/contact" element={<DhaamForm publishableKey="…" apiUrl="…" />} />
```

One host element, `mountForm` inside an effect, and a cleanup that destroys
the form and aborts its in-flight boot. Callbacks go through refs, so a new
arrow function per render is not a remount and a visitor does not lose what
they had typed. Survives React 18 StrictMode's mount → cleanup → mount
without a doubled form or a leaked boot, and touches no browser global at
module scope, so it is safe to import from a server-rendered route.

⚠️ This adds `@dhaam-ccrm/widget` as a REQUIRED peer dependency of this
package, including for consumers who only use the hooks: `DhaamForm` is
exported from the single entry point, so an unresolvable import is a build
error even when the component itself is tree-shaken away.
