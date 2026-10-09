import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Runs after `astro build` (turbo: test dependsOn build).
describe('built site', () => {
  it('renders the placeholder title', () => {
    const html = readFileSync(new URL('../dist/client/index.html', import.meta.url), 'utf8');
    expect(html).toContain('<title>Voidbinder</title>');
  });
});
