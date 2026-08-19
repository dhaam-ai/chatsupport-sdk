# @dhaam-ccrm/widget

## 0.1.0

### Minor Changes

- First published release of `@dhaam-ccrm/widget` — the drop-in embeddable chat
  widget: one script tag, shadow-DOM isolated, bubble / sidebar / sheet
  presentations.

  Two artifacts, deliberately different. `dist/widget.js` is a self-contained IIFE
  with core, `/js` and `/rest` inlined, for the `<script>` tag. The npm entry
  leaves them external so a bundler-using consumer carries one copy.

  Unlike the other bindings, core stays a regular **dependency** here: the widget
  never exposes a `ChatClient` across its API — config in, `ChatWidget` out — so
  there is no instance for a second copy of core to be wrong about. The internal
  ranges are `workspace:^`, so they publish as `^0.1.0` rather than an exact pin
  and dedupe with a consumer's own core.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @dhaam-ccrm/core@0.1.0
  - @dhaam-ccrm/js@0.1.0
  - @dhaam-ccrm/rest@0.1.0
