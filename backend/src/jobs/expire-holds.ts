import { expireStaleHolds } from '../modules/orders/orders.service.js';

/**
 * Flips pending orders past their hold to "expired" so the status is accurate.
 * Correctness does not depend on this job: availability is always computed from
 * expires_at, so an expired hold frees its units the moment it passes, even if
 * this job is late or not running.
 */
export function startExpirySweep(intervalMs: number): () => void {
  const timer = setInterval(() => {
    expireStaleHolds().catch((err) => console.error('expiry sweep failed', err));
  }, intervalMs);
  return () => clearInterval(timer);
}
