import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Runs after `astro build` (turbo: test dependsOn build).
const client = new URL('../dist/client/', import.meta.url);
const pages = readdirSync(client, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.html'))
  .map((f) => ({ file: f, html: readFileSync(new URL(f, client), 'utf8') }));

describe('built site', () => {
  it.each(['de', 'en'])('has the %s landing page', (locale) => {
    expect(existsSync(new URL(`${locale}/index.html`, client))).toBe(true);
  });

  // The strict CSP (VB-19) forbids inline style attributes; <style> elements are hashed instead.
  it('has no inline style attributes', () => {
    expect(pages.length).toBeGreaterThan(0);
    for (const { file, html } of pages) {
      expect(html, file).not.toMatch(/<[^>]+\sstyle\s*=/i);
    }
  });

  it('loads no images from outside the site', () => {
    for (const { file, html } of pages) {
      expect(html, file).not.toMatch(
        /<img\b[^>]*\ssrc(?:set)?\s*=\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i,
      );
    }
  });
});
