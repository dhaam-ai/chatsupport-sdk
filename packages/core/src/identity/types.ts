// Identity seam for @dhaam-ccrm/core — the shapes behind
// `ChatClientConfig.identityProfile` / `.identitySync`.
//
// Types only. This module emits no runtime code, so nothing here can reach
// the public barrel as a value and the hand-typed runtime allowlist in
// test/invariants/public-barrel-surface.test.ts is untouched by its addition.
//
// Both declarations below are copied verbatim from §3.1 of
// chat-service-node/docs/CONTACT_IDENTIFY_CONTRACT.md, which is frozen.
// `packages/rest` redeclares the same wire shape locally as
// `RestIdentityProfile` (§3.3) because rest must not depend on core, and
// nothing compares the two at compile time. Editing one side without the
// other silently breaks the wire contract rather than failing a build.

/**
 * Present only for a LOGGED-IN user. Its presence on WidgetIdentity — not
 * userId alone, which every guest also has — is what triggers a POST
 * /identify call. Never sent for a guest.
 */
export interface IdentityProfile {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly city?: string;
  readonly country?: string;
  readonly tags?: readonly string[];
  readonly device?: {
    readonly deviceId: string;
    readonly deviceToken?: string;
    readonly platform?: 'ios' | 'android' | 'web';
  };
}

/**
 * The injected seam — core does no HTTP of its own, following the exact
 * precedent MessageHistorySource / AttachmentUploader / SessionActions
 * already establish. packages/rest implements this via
 * createIdentitySync(client).
 */
export interface IdentitySync {
  sync(profile: IdentityProfile): Promise<void>;
}
