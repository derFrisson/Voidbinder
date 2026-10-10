import { z } from 'zod';

/** `GET /health`: 200 with `ok`, 503 with `degraded` when the database does not answer. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'error']),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Every API error. `issues` is set on 400 validation errors only. */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    issues: z
      .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
      .optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export * from './catalog.js';
export * from './search.js';
export * from './collection.js';
export * from './me.js';
export * from './prices.js';
export * from './decks.js';
export * from './sync.js';
export * from './modules.js';
