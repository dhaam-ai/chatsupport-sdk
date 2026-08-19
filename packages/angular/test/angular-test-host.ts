// A real Angular injector with a manually-flushed effect queue, and NOTHING
// else — no DOM, no zone.js, no TestBed, no `@angular/compiler`, no
// `@angular/platform-browser`. `vitest.config.ts`'s default `environment:
// 'node'` is enough to run every test in this package.
//
// ---------------------------------------------------------------------------
// Why this exists, and why it needs two ɵ symbols
// ---------------------------------------------------------------------------
//
// `effect()` is Angular's only public "run this when the signals it read
// change" primitive, and a root effect resolves `EffectScheduler` and
// `ChangeDetectionScheduler` from the injector. Both are normally supplied by
// application bootstrap (`bootstrapApplication` → `internalCreateApplication`),
// which needs a platform and therefore a DOM. Providing them directly is what
// buys a DOM-free test; it is also exactly what `TestBed.flushEffects()`/
// `TestBed.tick()` do internally, so this is the same seam Angular's own
// testing utilities use, reached without dragging in the browser platform.
//
// The third ɵ symbol, `ɵINJECTOR_SCOPE`, marks this injector as the `'root'`
// scope. `bootstrapApplication` sets it on the injector it creates, and
// without it a token declared `providedIn: 'root'` — which is how this package
// declares `CHAT_CLIENT`/`CHAT_STORE` — is simply not resolvable, so a test
// would be asserting against a container that behaves unlike every real
// application.
//
// All three symbols are `@angular/core` internals. They appear ONLY in this
// file, only in the test tree, and never in `src/` — the shipped
// `@dhaam-ccrm/angular` package uses nothing but documented public API.
// `assertHostTokensPresent()` below turns a future Angular removing or
// renaming any of them into a loud, single, obvious failure instead of a
// mystery.
//
// The `flush()` implementation mirrors `ZoneAwareEffectScheduler.flushQueue`
// in @angular/core (FIFO, skip non-dirty handles, repeat until nothing is
// dirty, and — deliberately — no try/catch that real Angular does not have,
// so this host can never be more forgiving of a throwing effect than a real
// application would be).

import {
  createEnvironmentInjector,
  Injector,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
  ɵEffectScheduler as EffectScheduler,
} from '@angular/core';
import type { EnvironmentInjector, EnvironmentProviders, Provider } from '@angular/core';

type SchedulableEffect = Parameters<EffectScheduler['add']>[0];

class ManualEffectScheduler extends EffectScheduler {
  private readonly queue = new Set<SchedulableEffect>();

  override add(handle: SchedulableEffect): void {
    this.queue.add(handle);
  }

  override schedule(_handle: SchedulableEffect): void {
    // No-op: `flush()` polls each handle's own `dirty` flag, so there is no
    // separate dirty count to keep in sync. (Angular's own scheduler keeps a
    // counter purely to avoid walking the queue when nothing is dirty.)
  }

  override remove(handle: SchedulableEffect): void {
    this.queue.delete(handle);
  }

  override flush(): void {
    let ranOneEffect = true;
    while (ranOneEffect) {
      ranOneEffect = false;
      for (const handle of [...this.queue]) {
        if (!handle.dirty) continue;
        ranOneEffect = true;
        handle.run();
      }
    }
  }
}

/** A `ChangeDetectionScheduler` that does nothing: with no views to render, a tick has no work. */
class NoopChangeDetectionScheduler extends ChangeDetectionScheduler {
  override runningTick = false;
  override notify(): void {}
}

export interface AngularTestHost {
  /** A real `EnvironmentInjector` — `injector.get(TOKEN)` and `runInInjectionContext(injector, ...)` both behave normally. */
  readonly injector: EnvironmentInjector;
  /** Runs every dirty effect created against {@link injector}. The DOM-free stand-in for `ApplicationRef.tick()`. */
  flushEffects(): void;
  /** Destroys the injector (and so every `DestroyRef.onDestroy` registered on it). Idempotent. */
  destroy(): void;
}

/**
 * Fails loudly if a future `@angular/core` stops exporting the internals this
 * host provides, rather than letting the symptom surface as an unrelated
 * NG0201 several layers deep.
 */
export function assertHostTokensPresent(): void {
  if (typeof EffectScheduler !== 'function' || typeof ChangeDetectionScheduler !== 'function' || INJECTOR_SCOPE === undefined) {
    throw new Error(
      '@angular/core no longer exports ɵEffectScheduler / ɵChangeDetectionScheduler / ɵINJECTOR_SCOPE. ' +
        'packages/angular/test/angular-test-host.ts needs updating (see its header) — ' +
        'the shipped package is unaffected, it uses only public API.',
    );
  }
}

export function createAngularTestHost(providers: readonly (Provider | EnvironmentProviders)[] = []): AngularTestHost {
  assertHostTokensPresent();

  const effectScheduler = new ManualEffectScheduler();
  const injector = createEnvironmentInjector(
    [
      { provide: INJECTOR_SCOPE, useValue: 'root' },
      { provide: EffectScheduler, useValue: effectScheduler },
      { provide: ChangeDetectionScheduler, useClass: NoopChangeDetectionScheduler },
      ...providers,
    ],
    Injector.NULL as unknown as EnvironmentInjector,
    'dhaam-ccrm-angular-test-host',
  );

  let destroyed = false;

  return {
    injector,
    flushEffects: () => effectScheduler.flush(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      injector.destroy();
    },
  };
}
