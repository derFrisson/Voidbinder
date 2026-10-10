import { describe, expect, it } from 'vitest';
import { plausibleOrigin } from './analytics';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

describe('Plausible (VB-74)', () => {
  it('is off without PLAUSIBLE_HOST: no origin, the CSP names no analytics host', () => {
    expect(plausibleOrigin(undefined)).toBeUndefined();
    expect(plausibleOrigin('')).toBeUndefined();
    expect(contentSecurityPolicy()).toContain(
      "script-src 'self' https://challenges.cloudflare.com;",
    );
    expect(contentSecurityPolicy()).toContain("connect-src 'self';");
    expect(contentSecurityPolicy()).not.toMatch(/plausible|cloudflareinsights/);
  });

  it('adds the host to script-src and connect-src, and only there', () => {
    const csp = contentSecurityPolicy('plausible.voidbinder.de');
    expect(plausibleOrigin('plausible.voidbinder.de')).toBe('https://plausible.voidbinder.de');
    expect(csp).toContain(
      "script-src 'self' https://plausible.voidbinder.de https://challenges.cloudflare.com;",
    );
    expect(csp).toContain("connect-src 'self' https://plausible.voidbinder.de;");
    expect(csp.match(/plausible/g)).toHaveLength(2);
    expect(securityHeaders(true, 'plausible.voidbinder.de')['Content-Security-Policy']).toBe(csp);
  });

  it('refuses a value that is not a bare hostname, because it ends up in a header', () => {
    for (const bad of ['https://plausible.voidbinder.de', 'a.de; script-src *', 'a b', '-a.de'])
      expect(() => plausibleOrigin(bad), bad).toThrow(/hostname/);
  });
});
