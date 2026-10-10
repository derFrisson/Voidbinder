import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { TcgdexImportWorkflow } from '../src/workflows/tcgdex-import';
import { YgoprodeckImportWorkflow } from '../src/workflows/ygoprodeck-import';
import { YugipediaImportWorkflow } from '../src/workflows/yugipedia-import';

it('ends the YGOPRODeck import with the image mirror and the search index steps', async () => {
  const names: string[] = [];
  // Records the step names without running them; the canned results make the import plan no chunks.
  const canned: Record<string, unknown> = { 'start run': 'run-1' };
  const step = {
    do: (name: string) => {
      names.push(name);
      return Promise.resolve(canned[name] ?? (name.startsWith('split') ? { chunks: 0 } : {}));
    },
    sleep: (name: string) => (names.push(name), Promise.resolve()),
  } as unknown as WorkflowStep;
  const event = { timestamp: new Date('2026-10-10'), payload: {} } as WorkflowEvent<unknown>;

  // workerd constructs a WorkflowEntrypoint only for a real instance; `run` needs just `env`.
  await YgoprodeckImportWorkflow.prototype.run.call({ env }, event, step);

  // The image mirror, then the start of the search index refresh (VB-98).
  expect(names.slice(-2)).toEqual(['mirror images', 'refresh search index']);
  // The edge cache is purged once the Hyperdrive-cached reads have expired (VB-71).
  const finish = names.indexOf('finish run');
  expect(names.slice(finish, finish + 3)).toEqual([
    'finish run',
    'wait for the Hyperdrive cache',
    'purge cache',
  ]);
});

it('ends the TCGdex import with the image mirror and the search index steps', async () => {
  const names: string[] = [];
  const canned: Record<string, unknown> = { 'start run': 'run-1', 'set list': [], plan: [] };
  const step = {
    do: (name: string) => {
      names.push(name);
      return Promise.resolve(canned[name] ?? {});
    },
    sleep: (name: string) => (names.push(name), Promise.resolve()),
  } as unknown as WorkflowStep;
  const event = { timestamp: new Date('2026-10-10'), payload: {} } as WorkflowEvent<unknown>;

  await TcgdexImportWorkflow.prototype.run.call({ env }, event, step);

  // The image mirror, then the start of the search index refresh (VB-98).
  expect(names.slice(-2)).toEqual(['mirror images', 'refresh search index']);
  // The edge cache is purged once the Hyperdrive-cached reads have expired (VB-71).
  const finish = names.indexOf('finish run');
  expect(names.slice(finish, finish + 3)).toEqual([
    'finish run',
    'wait for the Hyperdrive cache',
    'purge cache',
  ]);
});

it('adds the pokemontcg.io pictures between the TCGdex import and the mirror on Mondays (VB-118)', async () => {
  const retries: Record<string, unknown> = {};
  const run = async (day: string, payload: Record<string, unknown> = {}) => {
    const names: string[] = [];
    const canned: Record<string, unknown> = {
      'start run': 'run-1',
      'set list': [],
      plan: [],
      'pokemontcg: start run': 'run-2',
      'pokemontcg: plan': {
        sets: [{ code: '2021swsh', ptcg: 'mcd21' }],
        unmatched: [],
        coolingDown: 0,
      },
      'pokemontcg: cards 2021swsh': { prints: 1, matched: 1, written: 1 },
    };
    const step = {
      do: (name: string, config: { retries: { limit: number } }) => (
        names.push(name),
        (retries[name] = config.retries.limit),
        Promise.resolve(canned[name] ?? {})
      ),
      sleep: (name: string) => (names.push(name), Promise.resolve()),
    } as unknown as WorkflowStep;
    const event = { timestamp: new Date(day), payload } as WorkflowEvent<unknown>;
    await TcgdexImportWorkflow.prototype.run.call({ env }, event, step);
    return names;
  };

  const monday = await run('2026-10-12');
  const purge = monday.indexOf('purge cache');
  expect(monday.slice(purge)).toEqual([
    'purge cache',
    'pokemontcg: start run',
    'pokemontcg: plan',
    'pokemontcg: cards 2021swsh',
    'pokemontcg: finish run',
    'mirror images',
    'refresh search index',
  ]);
  // A pokemontcg.io outage fails fast: one retry, not the import's three.
  expect([retries['pokemontcg: plan'], retries['finish run']]).toEqual([1, 3]);
  // Other days only on request (POST /admin/import/tcgdex?pokemontcg=true).
  expect((await run('2026-10-10')).filter((n) => n.startsWith('pokemontcg'))).toEqual([]);
  expect(await run('2026-10-10', { pokemontcg: true })).toContain('pokemontcg: finish run');
});

it('runs the Yugipedia import without a purge when it planned nothing (VB-93)', async () => {
  const names: string[] = [];
  const canned: Record<string, unknown> = {
    'start run': 'run-1',
    plan: 0,
    'galleries: start run': 'run-2',
    'galleries: plan': 0,
    'set lists: start run': 'run-3',
    'set lists: plan': 0,
  };
  const step = {
    do: (name: string) => (names.push(name), Promise.resolve(canned[name] ?? {})),
    sleep: (name: string) => (names.push(name), Promise.resolve()),
  } as unknown as WorkflowStep;
  const event = { timestamp: new Date('2026-10-12'), payload: {} } as WorkflowEvent<unknown>;

  await YugipediaImportWorkflow.prototype.run.call({ env }, event, step);

  // Nothing written: no purge, no image mirror and no search index refresh either; the galleries
  // (VB-106) and the set lists (VB-94) follow the names.
  expect(names).toEqual([
    'start run',
    'plan',
    'finish run',
    'clean up chunks',
    'galleries: start run',
    'galleries: plan',
    'galleries: finish run',
    'galleries: clean up chunks',
    'set lists: start run',
    'set lists: plan',
    'set lists: finish run',
    'set lists: clean up chunks',
  ]);
});

it('ends the Yugipedia import with the search index step when it wrote names (VB-93)', async () => {
  const names: string[] = [];
  // One planned chunk whose lookup wrote a row; the chunk step itself is canned.
  const canned: Record<string, unknown> = {
    'start run': 'run-1',
    plan: 1,
    'cards 00000': { planned: 1, found: 1, missing: 0, written: 1 },
    'galleries: start run': 'run-2',
    'galleries: plan': 0,
    'set lists: start run': 'run-3',
    'set lists: plan': 0,
  };
  const step = {
    do: (name: string) => (names.push(name), Promise.resolve(canned[name] ?? {})),
    sleep: (name: string) => (names.push(name), Promise.resolve()),
  } as unknown as WorkflowStep;
  const event = { timestamp: new Date('2026-10-12'), payload: {} } as WorkflowEvent<unknown>;

  await YugipediaImportWorkflow.prototype.run.call({ env }, event, step);

  expect(names.slice(-2)).toEqual(['set lists: clean up chunks', 'refresh search index']);
  expect(names).toContain('purge cache');
});

it('purges and refreshes the search index when the set lists changed codes (VB-94)', async () => {
  const names: string[] = [];
  const canned: Record<string, unknown> = {
    'start run': 'run-1',
    plan: 0,
    'galleries: start run': 'run-2',
    'galleries: plan': 0,
    'set lists: start run': 'run-3',
    'set lists: plan': 1,
    'set lists 00000': { sets: 1, pages: 6, planned: 9, dropped: 3, written: 9 },
  };
  const step = {
    do: (name: string) => (names.push(name), Promise.resolve(canned[name] ?? {})),
    sleep: (name: string) => (names.push(name), Promise.resolve()),
  } as unknown as WorkflowStep;
  const event = { timestamp: new Date('2026-10-12'), payload: {} } as WorkflowEvent<unknown>;

  await YugipediaImportWorkflow.prototype.run.call({ env }, event, step);

  expect(names.slice(-5)).toEqual([
    'set lists: finish run',
    'set lists: wait for the Hyperdrive cache',
    'set lists: purge cache',
    'set lists: clean up chunks',
    'refresh search index',
  ]);
  expect(names).not.toContain('purge cache');
});

it('runs the galleries alone on request and mirrors the scans they found (VB-106)', async () => {
  const names: string[] = [];
  const canned: Record<string, unknown> = {
    'galleries: start run': 'run-2',
    'galleries: plan': 1,
    'galleries 00000': { sets: 1, pages: 1, planned: 1, found: 1, written: 1 },
  };
  const step = {
    do: (name: string) => (names.push(name), Promise.resolve(canned[name] ?? {})),
    sleep: (name: string) => (names.push(name), Promise.resolve()),
  } as unknown as WorkflowStep;
  const event = {
    timestamp: new Date('2026-10-12'),
    payload: { galleries: 'only' },
  } as WorkflowEvent<{ galleries: 'only' }>;

  await YugipediaImportWorkflow.prototype.run.call({ env }, event, step);

  expect(names).not.toContain('start run');
  expect(names).not.toContain('set lists: start run');
  // One purge, after the mirror, under names of its own (the names import may purge before).
  expect(names.slice(-4)).toEqual([
    'galleries: clean up chunks',
    'mirror images',
    'galleries: wait for the Hyperdrive cache',
    'galleries: purge cache',
  ]);
  expect(names).not.toContain('purge cache');
});
