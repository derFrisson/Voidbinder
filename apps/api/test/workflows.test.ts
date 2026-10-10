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

it('runs the Yugipedia import without a purge when it planned nothing (VB-93)', async () => {
  const names: string[] = [];
  const canned: Record<string, unknown> = { 'start run': 'run-1', plan: 0 };
  const step = {
    do: (name: string) => (names.push(name), Promise.resolve(canned[name] ?? {})),
    sleep: (name: string) => (names.push(name), Promise.resolve()),
  } as unknown as WorkflowStep;
  const event = { timestamp: new Date('2026-10-12'), payload: {} } as WorkflowEvent<unknown>;

  await YugipediaImportWorkflow.prototype.run.call({ env }, event, step);

  // Nothing written: no purge and no search index refresh either.
  expect(names).toEqual(['start run', 'plan', 'finish run', 'clean up chunks']);
});

it('ends the Yugipedia import with the search index step when it wrote names (VB-93)', async () => {
  const names: string[] = [];
  // One planned chunk whose lookup wrote a row; the chunk step itself is canned.
  const canned: Record<string, unknown> = {
    'start run': 'run-1',
    plan: 1,
    'cards 00000': { planned: 1, found: 1, missing: 0, written: 1 },
  };
  const step = {
    do: (name: string) => (names.push(name), Promise.resolve(canned[name] ?? {})),
    sleep: (name: string) => (names.push(name), Promise.resolve()),
  } as unknown as WorkflowStep;
  const event = { timestamp: new Date('2026-10-12'), payload: {} } as WorkflowEvent<unknown>;

  await YugipediaImportWorkflow.prototype.run.call({ env }, event, step);

  expect(names.slice(-2)).toEqual(['clean up chunks', 'refresh search index']);
  expect(names).toContain('purge cache');
});
