/**
 * Background jobs (catalog imports, price runs). Interface only: the catalog ticket (VB-26) adds
 * the implementation.
 */
export interface JobQueue {
  send(job: { type: string; payload: unknown }): Promise<void>;
}
