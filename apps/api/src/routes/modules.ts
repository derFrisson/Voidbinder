import { GameSchema } from '@voidbinder/shared';
import {
  ModuleManifestSchema,
  type ModuleManifest,
  type ModulesResponse,
} from '@voidbinder/shared/api';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { catalogCache } from '../middleware/catalog-cache';
import { log } from '../middleware/log';

/**
 * `GET /catalog/modules` (VB-29): the manifest of every game's offline catalog module, read from
 * the `CATALOG` bucket at `modules/<env>/<game>/manifest.json` (written by
 * scripts/build-catalog-module.ts on the VPS), cached like the catalog (ADR 0004). A game without
 * a manifest is left out; an unreadable one too, with a warning.
 */
export function moduleRoutes(env: string) {
  return new Hono<AppEnv>().use(catalogCache).get('/', async (c) => {
    const manifests = await Promise.all(
      GameSchema.options.map(async (game): Promise<ModuleManifest | null> => {
        const key = `modules/${env}/${game}/manifest.json`;
        const blob = await c.var.platform.blobStore.get(key);
        if (!blob) return null;
        const text = await new Response(blob.body as ReadableStream).text();
        try {
          return ModuleManifestSchema.parse(JSON.parse(text));
        } catch (err) {
          log('warn', { message: 'invalid catalog module manifest', key, error: String(err) });
          return null;
        }
      }),
    );
    const body: ModulesResponse = { modules: manifests.filter((m) => m !== null) };
    return c.json(body, 200);
  });
}
