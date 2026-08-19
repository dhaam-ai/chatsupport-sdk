// Same shorthand and same reason as packages/react/test/h.ts: the repo's
// root vitest.config.ts globs `*.test.ts`, not `*.test.tsx`, so this
// package's react-only files (this one and react-adapter.ts) are plain
// `.ts` and use `React.createElement` instead of JSX.

import { createElement } from 'react';

export const h = createElement;
