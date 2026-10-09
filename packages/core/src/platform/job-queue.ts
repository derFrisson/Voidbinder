/**
 * Background jobs (catalog imports, price runs). Delivery is at least once: a job, and each step
 * of it, may run more than once (retries, a resumed instance), so every job must be idempotent.
 */
export interface JobQueue {
  send(job: { type: string; payload: unknown }): Promise<void>;
}
