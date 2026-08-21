// Namespacing, and the one property that makes a shared browser store safe to
// partition by identity: the encoding has to be INJECTIVE. Two different
// participant ids that collapse to the same namespace would share a send queue
// and a remembered session, which is the bug the third namespace level exists
// to prevent — reintroduced inside the fix.

import { describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from './memory.js';
import { encodeNamespaceSegment, namespaced } from './namespace.js';

describe('encodeNamespaceSegment', () => {
  it('passes an ordinary id through untouched', () => {
    expect(encodeNamespaceSegment('12961')).toBe('12961');
    expect(encodeNamespaceSegment('guest_9f3c-11ee')).toBe('guest_9f3c-11ee');
  });

  it('makes a colon-bearing id usable — namespaced() would reject it raw', () => {
    // `auth0:1234` and `urn:user:9` are real identifier formats. Before this,
    // a host whose user ids looked like that took the widget down at
    // construction.
    expect(() => namespaced(new MemoryStorageAdapter(), 'auth0:1234')).toThrow(TypeError);
    expect(() => namespaced(new MemoryStorageAdapter(), encodeNamespaceSegment('auth0:1234'))).not.toThrow();
  });

  it('never maps two different ids onto one namespace', () => {
    const ids = ['a:b', 'a%3Ab', 'a%b', 'a%253Ab', 'a', 'a:', ':a'];
    const encoded = ids.map(encodeNamespaceSegment);
    expect(new Set(encoded).size).toBe(ids.length);
  });

  it('substitutes for an empty id, the one case with no encoding', () => {
    expect(encodeNamespaceSegment('')).toBe('_');
    expect(() => namespaced(new MemoryStorageAdapter(), encodeNamespaceSegment(''))).not.toThrow();
  });
});

describe('two identities against one backing store', () => {
  it('cannot read or overwrite each other', async () => {
    const shared = new MemoryStorageAdapter();
    const guest = namespaced(namespaced(shared, 'dhp_test_k'), encodeNamespaceSegment('guest_1'));
    const user = namespaced(namespaced(shared, 'dhp_test_k'), encodeNamespaceSegment('12961'));

    await guest.set('selectedSession', 'session_owned_by_the_guest');

    // The signed-in identity inheriting this is exactly the 404 the widget hit:
    // it re-joins a session belonging to somebody else.
    expect(await user.get('selectedSession')).toBeNull();

    await user.set('selectedSession', 'session_owned_by_the_user');
    expect(await guest.get('selectedSession')).toBe('session_owned_by_the_guest');
  });
});
