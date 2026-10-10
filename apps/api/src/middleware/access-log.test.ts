import { describe, expect, it } from 'vitest';
import { level } from './access-log';

describe('access log level', () => {
  it('treats a 401 as information, other 4xx as warnings and 5xx as errors', () => {
    expect(level(200)).toBe('info');
    expect(level(304)).toBe('info');
    expect(level(401)).toBe('info');
    expect(level(400)).toBe('warn');
    expect(level(404)).toBe('warn');
    expect(level(429)).toBe('warn');
    expect(level(500)).toBe('error');
    expect(level(503)).toBe('error');
  });
});
