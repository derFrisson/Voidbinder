import { and, eq, lt, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { waitlistSignups, type NewWaitlistSignupRow, type WaitlistSignupRow } from './schema';

export type WaitlistPatch = Partial<Omit<WaitlistSignupRow, 'id' | 'email' | 'createdAt'>>;

export interface ExpiryCutoffs {
  pendingBefore: Date;
  unsubscribedBefore: Date;
}
export interface PurgeCounts {
  pending: number;
  unsubscribed: number;
}

/** Storage seam for the waitlist handlers; tests use an in-memory fake. */
export interface WaitlistRepository {
  findByEmail(email: string): Promise<WaitlistSignupRow | null>;
  findByConfirmTokenHash(hash: string): Promise<WaitlistSignupRow | null>;
  findById(id: string): Promise<WaitlistSignupRow | null>;
  /** Inserts a new sign-up; null when the address already exists (a concurrent sign-up won). */
  insert(row: NewWaitlistSignupRow): Promise<WaitlistSignupRow | null>;
  update(id: string, patch: WaitlistPatch): Promise<void>;
  /**
   * Retention purge. Deletes `pending` rows whose `confirm_expires_at` is before `pendingBefore`
   * and `unsubscribed` rows whose `unsubscribed_at` is before `unsubscribedBefore` (a row exactly
   * at the cutoff stays). `confirmed` rows are never touched. Returns the number deleted.
   */
  deleteExpired(cutoffs: ExpiryCutoffs): Promise<PurgeCounts>;
}

export class DrizzleWaitlistRepository implements WaitlistRepository {
  constructor(private readonly db: NodePgDatabase) {}

  private async findOne(where: ReturnType<typeof eq>): Promise<WaitlistSignupRow | null> {
    const [row] = await this.db.select().from(waitlistSignups).where(where).limit(1);
    return row ?? null;
  }

  findByEmail(email: string) {
    return this.findOne(eq(waitlistSignups.email, email));
  }

  findByConfirmTokenHash(hash: string) {
    return this.findOne(eq(waitlistSignups.confirmTokenHash, hash));
  }

  findById(id: string) {
    return this.findOne(eq(waitlistSignups.id, id));
  }

  async insert(row: NewWaitlistSignupRow) {
    const [inserted] = await this.db
      .insert(waitlistSignups)
      .values(row)
      .onConflictDoNothing({ target: waitlistSignups.email })
      .returning();
    return inserted ?? null;
  }

  async update(id: string, patch: WaitlistPatch) {
    await this.db.update(waitlistSignups).set(patch).where(eq(waitlistSignups.id, id));
  }

  async deleteExpired({ pendingBefore, unsubscribedBefore }: ExpiryCutoffs): Promise<PurgeCounts> {
    const deleted = await this.db
      .delete(waitlistSignups)
      .where(
        or(
          and(
            eq(waitlistSignups.status, 'pending'),
            lt(waitlistSignups.confirmExpiresAt, pendingBefore),
          ),
          and(
            eq(waitlistSignups.status, 'unsubscribed'),
            lt(waitlistSignups.unsubscribedAt, unsubscribedBefore),
          ),
        ),
      )
      .returning({ status: waitlistSignups.status });
    return {
      pending: deleted.filter((r) => r.status === 'pending').length,
      unsubscribed: deleted.filter((r) => r.status === 'unsubscribed').length,
    };
  }
}
