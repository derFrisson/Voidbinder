import type { CardStore } from '@voidbinder/core';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export class DrizzleCardStore implements CardStore {
  constructor(private readonly db: NodePgDatabase) {}

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }
}
