// FIXTURE — a deliberate violation. Not shipped, not part of core.
//
// This module reads a DOM global while it is being EVALUATED, which is the
// exact failure `no-dom-at-module-scope.test.ts` exists to catch: importing it
// on a server throws before any consumer code runs.
//
// It exists so the poisoned-global harness can be pointed at a module that is
// KNOWN to violate the rule and be required to notice. A harness only ever
// aimed at compliant modules reports "clean" whether it works or not.
export const viewportWidth: number = (window as { innerWidth?: number }).innerWidth ?? 0;
