import { and, eq, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { priceMappings, prints } from '../../db/schema';

// The admin's mapping override, apart from the import code so the routes (and the app, which
// type-checks the API through `AppType`) do not pull the importers in.

export class MappingConflict extends Error {}

/**
 * An admin's mapping (`method` manual, confidence 100), which the importers never overwrite.
 * null when the print does not exist; MappingConflict when another print holds that external id
 * and finish manually. An automatic holder gives it up.
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
    const [other] = await tx
      .select({ printId: priceMappings.printId, method: priceMappings.method })
      .from(priceMappings)
      .where(
        and(
          eq(priceMappings.source, m.source),
          eq(priceMappings.externalId, m.externalId),
          eq(priceMappings.finish, m.finish),
          ne(priceMappings.printId, m.printId),
        ),
      );
    if (other?.method === 'manual')
      throw new MappingConflict(
        `${m.source} ${m.externalId} ${m.finish} is mapped to ${other.printId}`,
      );
    if (other)
      await tx
        .delete(priceMappings)
        .where(
          and(
            eq(priceMappings.printId, other.printId),
            eq(priceMappings.source, m.source),
            eq(priceMappings.finish, m.finish),
          ),
        );
    const values = {
      ...m,
      note: m.note ?? null,
      confidence: 100,
      method: 'manual',
      overriddenBy: 'admin',
    };
    const [row] = await tx
      .insert(priceMappings)
      .values(values)
      .onConflictDoUpdate({
        target: [priceMappings.printId, priceMappings.source, priceMappings.finish],
        set: { ...values, updatedAt: sql`now()` },
      })
      .returning();
    return row ?? null;
  });
}
