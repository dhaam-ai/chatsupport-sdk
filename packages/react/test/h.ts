// The repo's root vitest.config.ts globs `*.test.ts`, not `*.test.tsx` (see
// vitest.config.ts's `test.include` — out of this package's scope lock to
// change). Test files in this package are therefore plain `.ts`, and use
// `React.createElement` instead of JSX. This is that shorthand.

import { createElement } from 'react';

export const h = createElement;
