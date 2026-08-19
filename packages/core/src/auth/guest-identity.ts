// Guest identity — Gap A (see PLAN-v2-core-adoption.md). A visitor who never
// logs in still needs a stable id so their session/messages persist across
// a reload; this generates one and persists it via the platform-provided
// `StorageAdapter` (T4), scoped by the caller into its own namespace so it
// never collides with anything else sharing that adapter.

import type { StorageAdapter } from '../storage/index.js';
import { generateUlid } from '../ulid.js';

const GUEST_ID_KEY = 'guestId';

/**
 * Returns the persisted guest id, generating and storing one on first use.
 * A storage failure (per `StorageAdapter`'s failure contract — a rejection
 * means "unknown," not "absent") falls back to a fresh, unpersisted id for
 * this session only, rather than refusing to connect at all: a guest who
 * can't be remembered across reloads is still better than one who can't
 * chat.
 */
export async function getOrCreateGuestId(storage: StorageAdapter): Promise<string> {
  try {
    const existing = await storage.get(GUEST_ID_KEY);
    if (existing) return existing;
  } catch {
    // Treat as absent for this attempt — fall through to generating one.
  }

  const id = `guest_${generateUlid()}`;
  try {
    await storage.set(GUEST_ID_KEY, id);
  } catch {
    // Best-effort persistence — an unpersisted id still works for this session.
  }
  return id;
}
