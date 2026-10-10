import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Runs after `astro build` (turbo: test dependsOn build). The site sets no cookies and loads no
// third-party resources (the privacy policy says so, VB-18), so the built output has to agree.
const client = new URL('../dist/client/', import.meta.url);
const pages = readdirSync(client, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.html'))
  .map((file) => ({ file, html: readFileSync(new URL(file, client), 'utf8') }));

const ALLOWED_HOSTS = [
  'voidbinder.de',
  'twitch.tv',
  'github.com',
  'plausible.io', // the privacy policy links Plausible's data policy
  'voidcom.app',
  'cloudflare.com', // links to Cloudflare's own pages
];
// The web app CTA of the build under test (wrangler var PUBLIC_APP_URL: localhost, dev or prod).
const { PUBLIC_APP_URL } = (
  JSON.parse(readFileSync(new URL('../server/wrangler.json', client), 'utf8')) as {
    vars: { PUBLIC_APP_URL: string };
  }
).vars;
ALLOWED_HOSTS.push(new URL(PUBLIC_APP_URL).hostname);
const allowed = (host: string) => ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

const legalPaths = [
  ['de', 'impressum'],
  ['de', 'datenschutz'],
  ['en', 'imprint'],
  ['en', 'privacy'],
] as const;

describe('legal pages', () => {
  it.each(legalPaths)('/%s/%s/ is built with one h1 and the layout', (locale, slug) => {
    const html = readFileSync(new URL(`${locale}/${slug}/index.html`, client), 'utf8');
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(`<html lang="${locale}"`);
    expect(html).toContain('<footer');
  });

  it('shows the date and, in English, the binding German version', () => {
    const get = (p: string) => readFileSync(new URL(`${p}/index.html`, client), 'utf8');
    expect(get('de/datenschutz')).toContain('Stand: 2026-10');
    expect(get('en/privacy')).toContain('Last updated: 2026-10');
    expect(get('en/privacy')).toContain('href="/de/datenschutz/"');
    expect(get('en/imprint')).toContain('href="/de/impressum/"');
  });

  it('links the language switch to the other locale slug', () => {
    const html = readFileSync(new URL('de/impressum/index.html', client), 'utf8');
    expect(html).toContain('href="/en/imprint/"');
    expect(html).toContain(
      '<link rel="alternate" hreflang="en" href="https://voidbinder.de/en/imprint/"',
    );
  });

  it('links the locale-specific legal pages in the footer of every page', () => {
    // The root 404 is German and sits outside /<locale>/; its footer links /de/ like the German pages.
    const withFooter = pages.filter((p) => p.html.includes('<footer') && /^(de|en)\//.test(p.file));
    expect(withFooter.length).toBeGreaterThanOrEqual(6);
    for (const { file, html } of withFooter) {
      const locale = file.split('/')[0];
      const [imprint, privacy] =
        locale === 'de' ? ['impressum', 'datenschutz'] : ['imprint', 'privacy'];
      expect(html, file).toContain(`href="/${locale}/${imprint}/"`);
      expect(html, file).toContain(`href="/${locale}/${privacy}/"`);
    }
  });

  it('redirects the other locale slug, so the waitlist consent link works in both locales', () => {
    // The consent text links /<locale>/datenschutz/; in English that is an alias of /en/privacy.
    const redirects = readFileSync(new URL('_redirects', client), 'utf8');
    expect(redirects).toMatch(/^\/en\/datenschutz\/?\s+\/en\/privacy\/\s+301$/m);
    expect(redirects).toMatch(/^\/de\/imprint\/?\s+\/de\/impressum\/\s+301$/m);
  });
});

describe('no cookies, no storage, no third parties', () => {
  it('sets no cookie through meta tags', () => {
    for (const { file, html } of pages)
      expect(html, file).not.toMatch(/http-equiv\s*=\s*["']?set-cookie/i);
  });

  it('uses no cookie or web storage in any script', () => {
    const scripts: { name: string; code: string }[] = [];
    for (const { file, html } of pages) {
      for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        scripts.push({ name: `${file} (inline)`, code: m[2] ?? '' });
        const src = /\ssrc\s*=\s*["']?([^"'\s>]+)/i.exec(m[1] ?? '')?.[1];
        if (src?.startsWith('/') && existsSync(new URL(`.${src}`, client))) {
          scripts.push({ name: src, code: readFileSync(new URL(`.${src}`, client), 'utf8') });
        }
      }
    }
    for (const { name, code } of scripts) {
      expect(code, name).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    }
  });

  it('loads and links nothing from a host outside the allow-list', () => {
    for (const { file, html } of pages) {
      for (const [, value] of html.matchAll(
        /\s(?:src|href|action)\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)/gi,
      )) {
        const host = new URL(value?.startsWith('//') ? `https:${value}` : (value ?? '')).hostname;
        expect(allowed(host), `${file}: ${value}`).toBe(true);
      }
    }
  });
});
