// Public surface of the auth module — task T9 (folded together with Gap A,
// guest sessions — see auth-coordinator.ts's header).

export { AuthCoordinator, type AuthCoordinatorOptions, type GetToken } from './auth-coordinator.js';
export { getOrCreateGuestId } from './guest-identity.js';
export { decodeJwtExpiryMs } from './jwt.js';
export { TokenRefreshScheduler, type TokenRefreshSchedulerOptions } from './token-refresh-scheduler.js';
