# @dhaam-ccrm/rest

## 0.1.0

### Minor Changes

- First published release of `@dhaam-ccrm/rest` — `fetch`-based adapters for the
  seams core declares but deliberately does not implement: message history,
  attachment upload, and session actions.

  It has **no dependency on `@dhaam-ccrm/core` in either direction**. The adapters
  satisfy core's interfaces structurally, declaring the wire shapes locally, so
  this package installs standalone and a core upgrade does not force one here.

  A previously declared `peerDependencies: { "@dhaam-ccrm/core": "workspace:*" }`
  has been removed: there is no import edge to justify it, and `workspace:*`
  publishes as an **exact** version pin, which would have produced an unsatisfiable
  peer range for every consumer the moment core shipped a patch.
