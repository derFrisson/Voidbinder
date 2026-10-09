import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('./', import.meta.url);
const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.md'))
  .map((file) => {
    const raw = readFileSync(new URL(file, root), 'utf8');
    const [, frontmatter = '', body = ''] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw) ?? [];
    return { file, frontmatter, body };
  });
const byFile = (name: string) => {
  const f = files.find((x) => x.file === name);
  if (!f) throw new Error(`missing ${name}`);
  return f;
};

// The operator fills these before launch (docs/site/legal.md). The exact text is the contract:
// search the repo for "[MAX:" to find what is left.
const P = {
  name: '[MAX: Vor- und Nachname]',
  street: '[MAX: Straße Hausnummer]',
  city: '[MAX: PLZ Ort]',
  mail: '[MAX: E-Mail]',
  phone: '[MAX: Telefon oder weiterer Kontaktweg]',
  vat: '[MAX: USt-IdNr. falls vorhanden]',
  db: '[MAX: Datenbank-Anbieter und Region, z. B. Neon, Frankfurt]',
  authority: '[MAX: zuständige Landesdatenschutzbehörde]',
  unconfirmed: '[MAX: Aufbewahrungsfrist für unbestätigte Anmeldungen]',
  unsubscribed: '[MAX: Aufbewahrungsfrist abgemeldeter Adressen, Vorschlag 12 Monate]',
  logs: '[MAX: Speicherdauer Cloudflare-Logs]',
};
const known = Object.values(P);
const required: Record<string, string[]> = {
  'de/impressum.md': [P.name, P.street, P.city, P.mail, P.phone, P.vat],
  'en/imprint.md': [P.name, P.street, P.city, P.mail, P.phone, P.vat],
  'de/datenschutz.md': [
    P.name,
    P.street,
    P.city,
    P.mail,
    P.db,
    P.authority,
    P.unconfirmed,
    P.unsubscribed,
    P.logs,
  ],
  'en/privacy.md': [
    P.name,
    P.street,
    P.city,
    P.mail,
    P.db,
    P.authority,
    P.unconfirmed,
    P.unsubscribed,
    P.logs,
  ],
};

describe('legal content', () => {
  it('has one file per page and locale', () => {
    expect(files.map((f) => f.file).sort()).toEqual(Object.keys(required).sort());
  });

  it.each(Object.entries(required))('%s carries every required placeholder', (name, wanted) => {
    const { body } = byFile(name);
    for (const placeholder of wanted) expect(body, placeholder).toContain(placeholder);
  });

  it('writes every placeholder in the exact [MAX: …] form of the list', () => {
    for (const { file, body } of files) {
      const opened = body.match(/\[MAX/g) ?? [];
      const found = body.match(/\[MAX: [^\]\n]+\]/g) ?? [];
      expect(found.length, `${file}: malformed placeholder`).toBe(opened.length);
      for (const p of found) expect(known, `${file}: unknown placeholder ${p}`).toContain(p);
    }
  });

  it('uses the same placeholders in German and English', () => {
    const set = (name: string) =>
      [...new Set(byFile(name).body.match(/\[MAX: [^\]\n]+\]/g))].sort();
    expect(set('en/imprint.md')).toEqual(set('de/impressum.md'));
    expect(set('en/privacy.md')).toEqual(set('de/datenschutz.md'));
  });

  it('keeps the heading order: no h1 in the body, no skipped level', () => {
    for (const { file, body } of files) {
      let previous = 1; // the layout renders the h1
      for (const [, hashes] of body.matchAll(/^(#{1,6}) /gm)) {
        const level = hashes?.length ?? 0;
        expect(level, `${file}: h1 in body`).toBeGreaterThan(1);
        expect(level, `${file}: skipped heading level`).toBeLessThanOrEqual(previous + 1);
        previous = level;
      }
    }
  });

  it('says in English that the German version is binding, and links it', () => {
    expect(byFile('en/imprint.md').body).toMatch(
      /German version\]\(\/de\/impressum\/\) is the binding/,
    );
    expect(byFile('en/privacy.md').body).toMatch(
      /German version\]\(\/de\/datenschutz\/\) is the binding/,
    );
  });

  it('has title, description and updated in the frontmatter', () => {
    for (const { file, frontmatter } of files) {
      expect(frontmatter, file).toMatch(/^title: .+/m);
      expect(frontmatter, file).toMatch(/^description: .+/m);
      expect(frontmatter, file).toMatch(/^updated: '\d{4}-\d{2}'$/m);
    }
  });

  it('uses no dashes as punctuation', () => {
    for (const { file, body } of files) expect(body, file).not.toMatch(/[–—]/);
  });
});
