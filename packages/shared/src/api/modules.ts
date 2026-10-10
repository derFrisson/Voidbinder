import { z } from 'zod';
import { GameSchema } from '../index.js';

// Offline catalog modules (VB-29): a prebuilt SQLite file per game on R2 (img.voidbinder.de) with
// deltas between versions. The contract for the app: docs/architecture/catalog-module.md.

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** A file to download: its public URL, size in bytes and SHA-256 of exactly those bytes. */
export const ModuleFileSchema = z.object({
  url: z.url(),
  size: z.number().int().nonnegative(),
  sha256: Sha256Schema,
});
export type ModuleFile = z.infer<typeof ModuleFileSchema>;

/** `catalog-<game>-v<from>-v<to>.sql.gz`: turns the module of version `from` into `to`. */
export const ModuleDeltaSchema = ModuleFileSchema.extend({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});
export type ModuleDelta = z.infer<typeof ModuleDeltaSchema>;

/** `modules/<env>/<game>/manifest.json`. */
export const ModuleManifestSchema = z.object({
  game: GameSchema,
  /** The catalog_version the module was built from. */
  version: z.number().int().nonnegative(),
  /** Schema of the SQLite file (tables and columns). */
  schemaVersion: z.number().int().positive(),
  /** The oldest app module reader that can open this file; an older app keeps its module. */
  minAppSchemaVersion: z.number().int().positive(),
  builtAt: z.iso.datetime({ offset: true }),
  /** The gzipped SQLite file; `rawSize`/`rawSha256` describe it unpacked. */
  module: ModuleFileSchema.extend({
    rawSize: z.number().int().nonnegative(),
    rawSha256: Sha256Schema,
  }),
  /** Contiguous chain, oldest first, ending at `version`; empty when no delta is available. */
  deltas: z.array(ModuleDeltaSchema),
  /** Credit the module's content requires (Yu-Gi-Oh!: Yugipedia, CC BY-SA 4.0); also in `meta`. */
  attribution: z.string().optional(),
});
export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

/** `GET /catalog/modules`: the manifest of every game that has a module. */
export const ModulesResponseSchema = z.object({ modules: z.array(ModuleManifestSchema) });
export type ModulesResponse = z.infer<typeof ModulesResponseSchema>;
