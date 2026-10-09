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

// Operator facts filled on 2026-10-09 (docs/site/legal.md). The texts must carry them and no
// "[MAX:" placeholder may remain; a launch with a placeholder is a bug.
const FACTS = {
  name: 'Maximilian Tschauder',
  street: 'Hauptstraße 25',
  city: '88630 Pfullendorf',
  mail: 'max@voidcom.app',
  vat: 'DE319838280',
  db: 'Gravelines',
  authority: 'Baden-Württemberg',
};
const required: Record<string, string[]> = {
  'de/impressum.md': [FACTS.name, FACTS.street, FACTS.city, FACTS.mail, FACTS.vat],
  'en/imprint.md': [FACTS.name, FACTS.street, FACTS.city, FACTS.mail, FACTS.vat],
  'de/datenschutz.md': [
    FACTS.name,
    FACTS.street,
    FACTS.city,
    FACTS.mail,
    FACTS.db,
    FACTS.authority,
    '30 Tagen',
    'zwölf Monate',
  ],
  'en/privacy.md': [
    FACTS.name,
    FACTS.street,
    FACTS.city,
    FACTS.mail,
    FACTS.db,
    FACTS.authority,
    '30 days',
    'twelve months',
  ],
};

describe('legal content', () => {
  it('has one file per page and locale', () => {
    expect(files.map((f) => f.file).sort()).toEqual(Object.keys(required).sort());
  });

  it.each(Object.entries(required))('%s carries every operator fact', (name, wanted) => {
    const { body } = byFile(name);
    for (const fact of wanted) expect(body, fact).toContain(fact);
  });

  it('leaves no [MAX: …] placeholder behind', () => {
    for (const { file, body } of files) {
      expect(body, `${file}: placeholder left`).not.toMatch(/\[MAX/);
    }
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
