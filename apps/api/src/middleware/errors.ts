import type { ErrorResponse } from '@voidbinder/shared/api';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { log } from './log';

const CODES: Partial<Record<number, string>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
};

function errorJson(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  issues?: NonNullable<ErrorResponse['error']['issues']>,
) {
  const body: ErrorResponse = {
    error: { code, message, requestId: c.var.requestId, ...(issues && { issues }) },
  };
  return c.json(body, status);
}

/**
 * Turns every thrown error into `{ error: { code, message, requestId } }`. Zod errors (from
 * `throwOnInvalid` or a `.parse` in a handler) become 400 with `issues`; HTTPExceptions keep
 * their status and the headers of their `res`; anything else is a 500 whose message and stack go to the log only.
 */
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof z.core.$ZodError) {
    const issues = err.issues.map((i) => ({
      path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
      message: i.message,
    }));
    return errorJson(c, 400, 'invalid_request', 'Invalid request', issues);
  }
  if (err instanceof HTTPException && err.status < 500) {
    const status = err.status as ContentfulStatusCode;
    // A specific code rides on the exception's cause (`{ code: 'resync_required' }`).
    const code = (err.cause as { code?: unknown } | undefined)?.code;
    const res = errorJson(
      c,
      status,
      typeof code === 'string' ? code : (CODES[status] ?? 'bad_request'),
      err.message || 'Bad request',
    );
    // Headers of the exception's own response (e.g. `WWW-Authenticate` on a 401) survive; its
    // body and content headers give way to the JSON error.
    for (const [name, value] of err.res?.headers ?? []) {
      if (name !== 'content-type' && name !== 'content-length') res.headers.append(name, value);
    }
    return res;
  }
  log('error', {
    requestId: c.var.requestId,
    message: err.message,
    stack: err.stack,
  });
  return errorJson(c, 500, 'internal', 'Internal server error');
};

export const notFound: NotFoundHandler<AppEnv> = (c) => errorJson(c, 404, 'not_found', 'Not found');

/**
 * `zValidator` hook that throws the Zod error to `onError`, so validation failures have the same
 * shape as every other error: `zValidator('json', Schema, throwOnInvalid)`.
 */
export function throwOnInvalid(result: { success: boolean; error?: unknown }): void {
  if (!result.success) throw result.error;
}
