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

  it.each(['de', 'en'])('links Twitch and GitHub on the %s landing page', (locale) => {
    const html = readFileSync(new URL(`${locale}/index.html`, client), 'utf8');
    expect(html).toContain('https://www.twitch.tv/derFrisson');
    expect(html).toContain('https://github.com/derFrisson/Voidbinder');
  });

  it.each(['de', 'en'])('prerenders the %s waitlist status pages', (locale) => {
    for (const page of ['pending', 'confirmed', 'unsubscribed', 'expired']) {
      expect(existsSync(new URL(`${locale}/waitlist/${page}/index.html`, client)), page).toBe(true);
    }
  });

  // Turnstile (VB-72): the container carries the sitekey of the build's environment (the wrangler
  // var), the script itself is loaded on demand.
  it.each(['de', 'en'])('has the Turnstile container in the %s waitlist form', (locale) => {
    const html = readFileSync(new URL(`${locale}/index.html`, client), 'utf8');
    expect(html).toMatch(/class="turnstile"[^>]*\sdata-sitekey="(?:0x4|1x)[\w-]{20,}"/);
    expect(html).toContain(`data-language="${locale}"`);
    expect(html).not.toContain('challenges.cloudflare.com/turnstile/v0/api.js');
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

const all = (html: string, re: RegExp) => [...html.matchAll(new RegExp(re, 'g'))].map((m) => m[1]);

describe('SEO (VB-19)', () => {
  it.each(pages)('$file has a title, description, canonical, hreflang and og:image', ({ html }) => {
    expect(all(html, /<title>([^<]*)<\/title>/)).toHaveLength(1);
    expect(all(html, /<meta name="description" content="([^"]+)"/)).toHaveLength(1);
    expect(
      all(html, /<link rel="canonical" href="(https:\/\/voidbinder\.de\/[^"]*)"/),
    ).toHaveLength(1);
    for (const lang of ['de', 'en', 'x-default'])
      expect(html).toMatch(new RegExp(`<link rel="alternate" hreflang="${lang}" href="https://`));
    const [image] = all(
      html,
      /<meta property="og:image" content="https:\/\/voidbinder\.de\/([^"]+)"/,
    );
    expect(image).toBeDefined();
    expect(existsSync(new URL(image ?? '', client))).toBe(true);
  });

  it('has robots.txt pointing at the sitemap index', () => {
    expect(readFileSync(new URL('robots.txt', client), 'utf8')).toContain(
      'Sitemap: https://voidbinder.de/sitemap-index.xml',
    );
    expect(existsSync(new URL('sitemap-index.xml', client))).toBe(true);
  });

  it('has 404 pages for the root and both locales', () => {
    for (const file of ['404.html', 'de/404/index.html', 'en/404/index.html'])
      expect(existsSync(new URL(file, client)), file).toBe(true);
  });

  // Strict CSP: no inline scripts other than JSON-LD data blocks, no inline <style>.
  it('has no inline scripts or style elements', () => {
    for (const { file, html } of pages) {
      expect(html, file).not.toMatch(/<style[\s>]/i);
      for (const tag of html.match(/<script\b[^>]*>/gi) ?? [])
        expect(tag, file).toMatch(/\ssrc=|type="application\/ld\+json"/);
    }
  });

  it('sets no cookies', () => {
    const headers = readFileSync(new URL('_headers', client), 'utf8');
    expect(headers).toContain('Content-Security-Policy:');
    expect(headers).not.toMatch(/set-cookie/i);
    for (const { file, html } of pages)
      expect(html, file).not.toMatch(/document\.cookie|cookieStore/);
  });
});
