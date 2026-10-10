import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { TcgdexImportWorkflow } from '../src/workflows/tcgdex-import';
import { YgoprodeckImportWorkflow } from '../src/workflows/ygoprodeck-import';

it('ends the YGOPRODeck import with the image mirror step', async () => {
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

  expect(names.at(-1)).toBe('mirror images');
  // The edge cache is purged once the Hyperdrive-cached reads have expired (VB-71).
  const finish = names.indexOf('finish run');
  expect(names.slice(finish, finish + 3)).toEqual([
    'finish run',
    'wait for the Hyperdrive cache',
    'purge cache',
  ]);
});

it('ends the TCGdex import with the image mirror step', async () => {
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

  expect(names.at(-1)).toBe('mirror images');
  // The edge cache is purged once the Hyperdrive-cached reads have expired (VB-71).
  const finish = names.indexOf('finish run');
  expect(names.slice(finish, finish + 3)).toEqual([
    'finish run',
    'wait for the Hyperdrive cache',
    'purge cache',
  ]);
});
