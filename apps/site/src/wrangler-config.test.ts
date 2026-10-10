import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CI builds only the local environment, so the dev and prod values the deploys depend on are
// pinned here (VB-74). wrangler.jsonc has comments and trailing commas; strings are skipped so
// the `//` in URLs survives.
const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : ''))
  .replace(/,(\s*[}\]])/g, '$1');
type Vars = { PUBLIC_APP_URL?: string; PLAUSIBLE_HOST?: string };
const config = JSON.parse(text) as {
  vars?: Vars;
  env: { dev: { vars: Vars }; prod: { vars: Vars } };
};

describe('wrangler.jsonc site vars (VB-74)', () => {
  it('points prod at the app and the shared Plausible', () => {
    expect(config.env.prod.vars.PUBLIC_APP_URL).toBe('https://app.voidbinder.de');
    expect(config.env.prod.vars.PLAUSIBLE_HOST).toBe('web-analytics.voidcom.app');
  });

  it('points dev at the dev app', () => {
    expect(config.env.dev.vars.PUBLIC_APP_URL).toBe(
      'https://voidbinder-app-dev.frisson.workers.dev',
    );
  });

  it('sets PLAUSIBLE_HOST in prod only', () => {
    expect(config.vars?.PLAUSIBLE_HOST).toBeUndefined();
    expect(config.env.dev.vars.PLAUSIBLE_HOST).toBeUndefined();
  });
});
