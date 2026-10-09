import type { HealthResponse } from '@voidbinder/shared/api';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createApiClient } from './client';
import { testApp } from './test-helpers';

describe('createApiClient', () => {
  it('calls the app and returns typed JSON', async () => {
    const app = testApp();
    const client = createApiClient('http://api.test', {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
    });
    const res = await client.health.$get();
    const body = await res.json();
    expectTypeOf(body).toEqualTypeOf<HealthResponse>();
    expect(body).toEqual({ status: 'ok', db: 'ok', version: 'test' });
  });
});
