/** A failed API call: the HTTP status and the API's error code (`{ error: { code } }`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API ${status} ${code}`);
  }
}

/** The JSON body of a response, or an `ApiError` for anything but 2xx. */
export async function read<T>(
  response: Promise<{ ok: boolean; status: number; json(): Promise<T> }>,
) {
  const res = await response;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? 'http_error');
  }
  return res.json();
}

/** Retry transient failures, never a 4xx: a 404 or 401 does not get better by asking again. */
export function retry(failureCount: number, error: Error): boolean {
  return !(error instanceof ApiError && error.status < 500) && failureCount < 2;
}
