import { describe, expect, it } from 'vitest';
import type { PresenceEntry } from '../protocol/index.js';
import { ChatStore } from '../state/index.js';
import type { OutboundIntent } from './intents.js';
import { PresenceRegistry } from './presence.js';

interface Harness {
  readonly store: ChatStore;
  readonly intents: OutboundIntent[];
  readonly presence: PresenceRegistry;
  readonly events: PresenceEntry[];
}

function harness(): Harness {
  const store = new ChatStore();
  const intents: OutboundIntent[] = [];
  const events: PresenceEntry[] = [];
  const presence = new PresenceRegistry({ store, emitIntent: (intent) => intents.push(intent) });

  store.on('presenceUpdate', (entry) => events.push(entry));

  return { store, intents, presence, events };
}

describe('PresenceRegistry — inbound', () => {
  it('records a presence.update and emits the §6.5 event', () => {
    const h = harness();
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });

    expect(h.presence.statusOf('agent-1')).toBe('ONLINE');
    expect(h.events).toEqual([{ participantId: 'agent-1', status: 'ONLINE' }]);
  });

  it('carries lastSeen through for an offline participant', () => {
    const h = harness();
    h.presence.applyPresenceUpdate({
      participantId: 'agent-1',
      status: 'OFFLINE',
      lastSeen: '2024-01-01T00:00:00.000Z',
    });

    expect(h.presence.get('agent-1')).toEqual({
      participantId: 'agent-1',
      status: 'OFFLINE',
      lastSeen: '2024-01-01T00:00:00.000Z',
    });
  });

  it('applies the newest frame, without a monotonicity rule', () => {
    // Deliberately unlike watermarks: presence is a current fact with no
    // ordering key, so ONLINE→OFFLINE→ONLINE must all land.
    const h = harness();
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });
    h.presence.applyPresenceUpdate({
      participantId: 'agent-1',
      status: 'OFFLINE',
      lastSeen: '2024-01-01T00:00:00.000Z',
    });
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });

    expect(h.presence.get('agent-1')).toEqual({ participantId: 'agent-1', status: 'ONLINE' });
    expect(h.events).toHaveLength(3);
  });

  it('does not re-emit an update that restates the known status', () => {
    const h = harness();
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });

    expect(h.events).toHaveLength(1);
  });

  it('re-emits when only lastSeen moved', () => {
    const h = harness();
    h.presence.applyPresenceUpdate({
      participantId: 'agent-1',
      status: 'OFFLINE',
      lastSeen: '2024-01-01T00:00:00.000Z',
    });
    h.presence.applyPresenceUpdate({
      participantId: 'agent-1',
      status: 'OFFLINE',
      lastSeen: '2024-01-02T00:00:00.000Z',
    });

    expect(h.events).toHaveLength(2);
  });

  it('tracks every PresenceStatus value from the protocol enum', () => {
    const h = harness();
    for (const status of ['ONLINE', 'AWAY', 'DND', 'OFFLINE'] as const) {
      h.presence.applyPresenceUpdate({ participantId: 'agent-1', status });
      expect(h.presence.statusOf('agent-1')).toBe(status);
    }
    expect(h.events).toHaveLength(4);
  });

  it('tracks participants independently', () => {
    const h = harness();
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });
    h.presence.applyPresenceUpdate({ participantId: 'agent-2', status: 'DND' });

    expect(h.presence.statusOf('agent-1')).toBe('ONLINE');
    expect(h.presence.statusOf('agent-2')).toBe('DND');
    expect(h.presence.all()).toHaveLength(2);
  });

  it('applies a presence.query ack snapshot entry by entry', () => {
    const h = harness();
    h.presence.applyPresenceSnapshot([
      { participantId: 'agent-1', status: 'ONLINE' },
      { participantId: 'agent-2', status: 'AWAY' },
    ]);

    expect(h.presence.statusOf('agent-1')).toBe('ONLINE');
    expect(h.presence.statusOf('agent-2')).toBe('AWAY');
    expect(h.events).toHaveLength(2);
  });

  it('emits nothing for a query snapshot that confirms what is already known', () => {
    const h = harness();
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });
    h.presence.applyPresenceSnapshot([{ participantId: 'agent-1', status: 'ONLINE' }]);

    expect(h.events).toHaveLength(1);
  });

  it('reports undefined for a participant never seen', () => {
    const h = harness();
    expect(h.presence.get('nobody')).toBeUndefined();
    expect(h.presence.statusOf('nobody')).toBeUndefined();
  });
});

describe('PresenceRegistry — outbound intents', () => {
  it('produces a presence.set intent', () => {
    const h = harness();
    h.presence.setPresence('AWAY');

    expect(h.intents).toEqual([{ t: 'presence.set', d: { status: 'AWAY' } }]);
  });

  it('does not optimistically echo our own presence into the registry', () => {
    // The frame carries no participantId, so there is no key to record under.
    const h = harness();
    h.presence.setPresence('DND');

    expect(h.presence.all()).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('produces a targeted presence.query intent', () => {
    const h = harness();
    h.presence.queryPresence(['agent-1', 'agent-2']);

    expect(h.intents).toEqual([{ t: 'presence.query', d: { participantIds: ['agent-1', 'agent-2'] } }]);
  });

  it('omits participantIds entirely for a whole-session query (exactOptionalPropertyTypes)', () => {
    const h = harness();
    h.presence.queryPresence();

    expect(h.intents).toEqual([{ t: 'presence.query', d: {} }]);
    expect('participantIds' in (h.intents[0]?.d ?? {})).toBe(false);
  });

  it('copies the queried ids, so a caller mutating its array cannot alter the intent', () => {
    const h = harness();
    const ids = ['agent-1'];
    h.presence.queryPresence(ids);
    ids.push('agent-2');

    expect(h.intents[0]?.d).toEqual({ participantIds: ['agent-1'] });
  });
});

describe('PresenceRegistry — clear', () => {
  it('discards everything learned over a socket that has gone away', () => {
    const h = harness();
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });
    h.presence.clear();

    expect(h.presence.all()).toEqual([]);
    expect(h.presence.get('agent-1')).toBeUndefined();
  });

  it('re-emits on reconnect because the cleared registry has no prior to match', () => {
    const h = harness();
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });
    h.presence.clear();
    h.presence.applyPresenceUpdate({ participantId: 'agent-1', status: 'ONLINE' });

    expect(h.events).toHaveLength(2);
  });
});
