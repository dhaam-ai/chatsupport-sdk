import { describe, expect, it } from 'vitest';

import { deepFreeze } from './freeze.js';

// ESM modules are always strict mode, so writing to a frozen object throws
// rather than failing silently. Every assertion below relies on that.

describe('deepFreeze', () => {
  it('returns the same reference it was given', () => {
    const value = { a: 1 };

    expect(deepFreeze(value)).toBe(value);
  });

  it('passes primitives and null through untouched', () => {
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(undefined)).toBeUndefined();
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze('text')).toBe('text');
  });

  it('freezes nested objects, not just the root', () => {
    const value = deepFreeze({ outer: { inner: { depth: 3 } } });

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.outer)).toBe(true);
    expect(Object.isFrozen(value.outer.inner)).toBe(true);
    expect(() => {
      (value.outer.inner as { depth: number }).depth = 99;
    }).toThrow(TypeError);
  });

  it('freezes arrays against every mutating method', () => {
    const value = deepFreeze({ items: [{ id: 'a' }] });

    // push/splice/index-assign are the three realistic ways a consumer
    // corrupts a shared array.
    expect(() => value.items.push({ id: 'b' })).toThrow(TypeError);
    expect(() => value.items.splice(0, 1)).toThrow(TypeError);
    expect(() => {
      value.items[0] = { id: 'c' };
    }).toThrow(TypeError);
  });

  it('freezes objects held inside an array', () => {
    const value = deepFreeze({ items: [{ id: 'a' }] });

    expect(() => {
      (value.items[0] as { id: string }).id = 'mutated';
    }).toThrow(TypeError);
  });

  it('does not re-walk an already-frozen subtree reached from a new root', () => {
    // The amortized-cost claim in the docblock, stated as the store actually
    // exercises it: a *new* top-level object reusing an *old* frozen subtree
    // (exactly what `{...state, unreadCount: 1}` produces) must not re-walk
    // that subtree. Property reads are counted via a getter reachable only
    // through the old branch.
    let reads = 0;
    const oldBranch = {
      get probe() {
        reads += 1;
        return 1;
      },
    };
    deepFreeze(oldBranch);
    const readsAfterFirstFreeze = reads;
    expect(readsAfterFirstFreeze).toBeGreaterThan(0);

    // A brand-new root that carries the already-frozen branch plus new data.
    const nextRoot = deepFreeze({ oldBranch, added: { fresh: true } });

    expect(reads).toBe(readsAfterFirstFreeze);
    expect(Object.isFrozen(nextRoot)).toBe(true);
    expect(Object.isFrozen(nextRoot.added)).toBe(true);
  });

  it('terminates on a cyclic graph', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.self = node;

    expect(() => deepFreeze(node)).not.toThrow();
    expect(Object.isFrozen(node)).toBe(true);
  });

  it('freezes a realistic ChatState-shaped graph end to end', () => {
    const state = deepFreeze({
      messages: [{ id: 'm1', metadata: { attachment: { url: 'https://x/y' } } }],
      readWatermarks: { 'p-1': '2026-01-01T00:00:00.000Z' },
      typing: { isTyping: false },
    });

    expect(() => state.messages.push({ id: 'm2', metadata: { attachment: { url: '' } } })).toThrow(
      TypeError,
    );
    expect(() => {
      state.readWatermarks['p-1'] = 'tampered';
    }).toThrow(TypeError);
    // Metadata is app-supplied and opaque to core, but it is still adopted
    // into the immutable snapshot — no unfrozen hole in the graph.
    expect(() => {
      (state.messages[0] as { metadata: { attachment: { url: string } } }).metadata.attachment.url =
        'tampered';
    }).toThrow(TypeError);
  });
});
