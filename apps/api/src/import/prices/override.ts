import { and, eq, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { priceMappings, prints } from '../../db/schema';

// The admin's mapping override, apart from the import code so the routes (and the app, which
// type-checks the API through `AppType`) do not pull the importers in.

export class MappingConflict extends Error {}

/** ponytail: only TCGplayer (the English market) takes manual mappings; a `lang` param with part 2. */
const LANG = 'en';

/**
 * An admin's mapping (`method` manual, confidence 100), which the importers never overwrite.
 * null when the print does not exist; MappingConflict when another print holds that external id
 * and finish manually. Every automatic holder gives it up.
 */
export async function setManualMapping(
  db: NodePgDatabase,
  m: {
    printId: string;
    source: string;
    finish: string;
    externalId: string;
    note?: string | undefined;
  },
) {
  return db.transaction(async (tx) => {
    const [print] = await tx.select({ id: prints.id }).from(prints).where(eq(prints.id, m.printId));
    if (!print) return null;
    // Several prints may hold one product automatically (VB-110: Yu-Gi-Oh! regional prints).
    const others = and(
      eq(priceMappings.source, m.source),
      eq(priceMappings.externalId, m.externalId),
      eq(priceMappings.finish, m.finish),
      eq(priceMappings.lang, LANG),
      ne(priceMappings.printId, m.printId),
    );
    const [manual] = await tx
      .select({ printId: priceMappings.printId })
      .from(priceMappings)
      .where(and(others, eq(priceMappings.method, 'manual')));
    if (manual)
      throw new MappingConflict(
        `${m.source} ${m.externalId} ${m.finish} is mapped to ${manual.printId}`,
      );
    await tx.delete(priceMappings).where(others);
    const values = {
      ...m,
      lang: LANG,
      note: m.note ?? null,
      confidence: 100,
      method: 'manual',
      overriddenBy: 'admin',
    };
    const [row] = await tx
      .insert(priceMappings)
      .values(values)
      .onConflictDoUpdate({
        target: [
          priceMappings.printId,
          priceMappings.source,
          priceMappings.finish,
          priceMappings.lang,
        ],
        set: { ...values, updatedAt: sql`now()` },
      })
      .returning();
    return row ?? null;
  });
}
