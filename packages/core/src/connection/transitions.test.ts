import { describe, expect, it, vi } from 'vitest';

import { CONNECTION_STATE_VALUES, ChatStore, createInitialChatState } from '../state/index.js';
import type { ConnectionState } from '../state/index.js';
import {
  CONNECTION_TRANSITIONS,
  ConnectionStateMachine,
  IllegalConnectionTransitionError,
  canTransition,
} from './transitions.js';

/** Every ordered pair of distinct states — the full edge space the table partitions. */
function allEdges(): Array<readonly [ConnectionState, ConnectionState]> {
  const edges: Array<readonly [ConnectionState, ConnectionState]> = [];
  for (const from of CONNECTION_STATE_VALUES) {
    for (const to of CONNECTION_STATE_VALUES) {
      if (from !== to) edges.push([from, to]);
    }
  }
  return edges;
}

/** Drives a machine to `target` along a known-legal path, so tests can start anywhere. */
const PATH_TO: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  idle: [],
  connecting: ['connecting'],
  authenticating: ['connecting', 'authenticating'],
  connected: ['connecting', 'authenticating', 'connected'],
  reconnecting: ['connecting', 'reconnecting'],
  suspended: ['connecting', 'suspended'],
  closed: ['closed'],
};

function machineAt(state: ConnectionState): { machine: ConnectionStateMachine; store: ChatStore } {
  const store = new ChatStore({ initialState: createInitialChatState() });
  const machine = new ConnectionStateMachine(store);
  for (const step of PATH_TO[state]) machine.to(step);
  expect(machine.state).toBe(state);
  return { machine, store };
}

describe('CONNECTION_TRANSITIONS', () => {
  it('covers exactly the seven §8.1 states as keys', () => {
    expect(Object.keys(CONNECTION_TRANSITIONS).sort()).toEqual([...CONNECTION_STATE_VALUES].sort());
  });

  it('names only real states as destinations', () => {
    for (const [from, targets] of Object.entries(CONNECTION_TRANSITIONS)) {
      for (const to of targets) {
        expect(CONNECTION_STATE_VALUES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('never lists a state as its own destination — self-transitions are no-ops, not edges', () => {
    for (const [from, targets] of Object.entries(CONNECTION_TRANSITIONS)) {
      expect(targets, from).not.toContain(from);
    }
  });

  it('lists no destination twice', () => {
    for (const [from, targets] of Object.entries(CONNECTION_TRANSITIONS)) {
      expect(new Set(targets).size, from).toBe(targets.length);
    }
  });

  it('gives `idle` no inbound edge — "not attempted yet" never becomes true again', () => {
    for (const [from, targets] of Object.entries(CONNECTION_TRANSITIONS)) {
      expect(targets, `${from} -> idle`).not.toContain('idle');
    }
  });

  it('leaves `closed` only towards `connecting` — no automatic escape (§8.1)', () => {
    expect(CONNECTION_TRANSITIONS.closed).toEqual(['connecting']);
  });

  it('leaves `suspended` only towards `connecting` or `closed` — never a retry edge', () => {
    expect([...CONNECTION_TRANSITIONS.suspended].sort()).toEqual(['closed', 'connecting']);
    expect(CONNECTION_TRANSITIONS.suspended).not.toContain('reconnecting');
    expect(CONNECTION_TRANSITIONS.suspended).not.toContain('authenticating');
  });

  it('allows connected -> connecting for the D3 reauth fallback, but not connected -> authenticating', () => {
    expect(CONNECTION_TRANSITIONS.connected).toContain('connecting');
    expect(CONNECTION_TRANSITIONS.connected).not.toContain('authenticating');
  });

  it('makes every state reachable from `idle`', () => {
    const seen = new Set<ConnectionState>(['idle']);
    const queue: ConnectionState[] = ['idle'];
    while (queue.length > 0) {
      const current = queue.shift() as ConnectionState;
      for (const next of CONNECTION_TRANSITIONS[current]) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    expect([...seen].sort()).toEqual([...CONNECTION_STATE_VALUES].sort());
  });
});

describe('canTransition', () => {
  it('agrees with the table on every ordered pair of distinct states', () => {
    for (const [from, to] of allEdges()) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(
        CONNECTION_TRANSITIONS[from].includes(to),
      );
    }
  });

  it('reports a self-transition as legal (it is a no-op, not an edge)', () => {
    for (const state of CONNECTION_STATE_VALUES) {
      expect(canTransition(state, state), state).toBe(true);
    }
  });
});

describe('ConnectionStateMachine', () => {
  it('starts from the store’s current connectionState', () => {
    const store = new ChatStore({ initialState: createInitialChatState() });
    expect(new ConnectionStateMachine(store).state).toBe('idle');

    const resumed = new ChatStore({
      initialState: { ...createInitialChatState(), connectionState: 'suspended' },
    });
    expect(new ConnectionStateMachine(resumed).state).toBe('suspended');
  });

  it('writes each transition through to ChatState.connectionState', () => {
    const { machine, store } = machineAt('idle');

    machine.to('connecting');
    expect(store.getState().connectionState).toBe('connecting');

    machine.to('authenticating');
    expect(store.getState().connectionState).toBe('authenticating');

    machine.to('connected');
    expect(store.getState().connectionState).toBe('connected');
  });

  it('takes every legal edge from every state without throwing', () => {
    for (const [from, to] of allEdges()) {
      if (!CONNECTION_TRANSITIONS[from].includes(to)) continue;
      const { machine, store } = machineAt(from);
      expect(() => machine.to(to), `${from} -> ${to}`).not.toThrow();
      expect(machine.state).toBe(to);
      expect(store.getState().connectionState).toBe(to);
    }
  });

  it('throws IllegalConnectionTransitionError on every edge the table omits', () => {
    let checked = 0;
    for (const [from, to] of allEdges()) {
      if (CONNECTION_TRANSITIONS[from].includes(to)) continue;
      checked += 1;

      const { machine, store } = machineAt(from);
      expect(() => machine.to(to), `${from} -> ${to}`).toThrow(IllegalConnectionTransitionError);

      // A rejected transition leaves both the machine and the store untouched.
      expect(machine.state, `${from} -> ${to}`).toBe(from);
      expect(store.getState().connectionState, `${from} -> ${to}`).toBe(from);
    }
    // 7*6 = 42 ordered pairs of distinct states. 20 are legal
    // (2+4+4+4+3+2+1, in §8.1 order), so 22 must be rejected.
    const legal = Object.values(CONNECTION_TRANSITIONS).reduce((n, list) => n + list.length, 0);
    expect(legal).toBe(20);
    expect(checked).toBe(42 - legal);
  });

  it('names both ends of the illegal edge on the error', () => {
    const { machine } = machineAt('idle');
    try {
      machine.to('connected');
      expect.unreachable('idle -> connected must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalConnectionTransitionError);
      const illegal = error as IllegalConnectionTransitionError;
      expect(illegal.from).toBe('idle');
      expect(illegal.to).toBe('connected');
      expect(illegal.name).toBe('IllegalConnectionTransitionError');
      expect(illegal.message).toContain('idle -> connected');
    }
  });

  it('rejects the specific illegal edges that would break §8.1 guarantees', () => {
    // `suspended` must not slide back into auto-retry.
    expect(() => machineAt('suspended').machine.to('reconnecting')).toThrow(
      IllegalConnectionTransitionError,
    );
    // `closed` is terminal for everything except an explicit connect().
    expect(() => machineAt('closed').machine.to('reconnecting')).toThrow(
      IllegalConnectionTransitionError,
    );
    expect(() => machineAt('closed').machine.to('connected')).toThrow(
      IllegalConnectionTransitionError,
    );
    // Nothing ever returns to "no connection attempted yet".
    expect(() => machineAt('connected').machine.to('idle')).toThrow(
      IllegalConnectionTransitionError,
    );
    // A socket cannot authenticate before it is open.
    expect(() => machineAt('idle').machine.to('authenticating')).toThrow(
      IllegalConnectionTransitionError,
    );
    // A backoff timer must fire into `connecting`, never straight to live.
    expect(() => machineAt('reconnecting').machine.to('connected')).toThrow(
      IllegalConnectionTransitionError,
    );
  });

  it('treats a self-transition as a no-op: no store write, no listener call', () => {
    const onTransition = vi.fn();
    const store = new ChatStore({ initialState: createInitialChatState() });
    const machine = new ConnectionStateMachine(store, onTransition);

    machine.to('connecting');
    onTransition.mockClear();
    const before = store.getState();

    expect(machine.to('connecting')).toBe(false);
    expect(store.getState()).toBe(before); // identical reference: no new snapshot
    expect(onTransition).not.toHaveBeenCalled();
  });

  it('reports true and notifies the listener with (to, from) on a real move', () => {
    const onTransition = vi.fn();
    const store = new ChatStore({ initialState: createInitialChatState() });
    const machine = new ConnectionStateMachine(store, onTransition);

    expect(machine.to('connecting')).toBe(true);
    expect(onTransition).toHaveBeenCalledWith('connecting', 'idle');
  });

  it('has already moved by the time the listener runs', () => {
    const store = new ChatStore({ initialState: createInitialChatState() });
    const seen: ConnectionState[] = [];
    const machine: ConnectionStateMachine = new ConnectionStateMachine(store, () => {
      seen.push(machine.state);
      seen.push(store.getState().connectionState);
    });

    machine.to('connecting');
    expect(seen).toEqual(['connecting', 'connecting']);
  });

  it('answers canGoTo from the state it is actually in', () => {
    const { machine } = machineAt('connected');
    expect(machine.canGoTo('reconnecting')).toBe(true);
    expect(machine.canGoTo('connecting')).toBe(true);
    expect(machine.canGoTo('idle')).toBe(false);
    expect(machine.canGoTo('connected')).toBe(true); // no-op
  });

  it('does not read the state back from the store mid-notification', () => {
    // ChatStore.getState() returns the snapshot *being delivered* during a
    // flush. A machine that re-read the store here would compute its next edge
    // from a state it had already left.
    const store = new ChatStore({ initialState: createInitialChatState() });
    const machine = new ConnectionStateMachine(store);
    machine.to('connecting');

    let observed: ConnectionState | null = null;
    store.subscribe(() => {
      machine.to('authenticating');
      observed = machine.state;
    });

    return Promise.resolve().then(() => {
      expect(observed).toBe('authenticating');
      expect(machine.state).toBe('authenticating');
    });
  });
});
