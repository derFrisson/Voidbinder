import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { waitlistSignups, type NewWaitlistSignupRow, type WaitlistSignupRow } from './schema';

export type WaitlistPatch = Partial<Omit<WaitlistSignupRow, 'id' | 'email' | 'createdAt'>>;

/** Storage seam for the waitlist handlers; tests use an in-memory fake. */
export interface WaitlistRepository {
  findByEmail(email: string): Promise<WaitlistSignupRow | null>;
  findByConfirmTokenHash(hash: string): Promise<WaitlistSignupRow | null>;
  findByUnsubscribeTokenHash(hash: string): Promise<WaitlistSignupRow | null>;
  /** Inserts a new sign-up; null when the address already exists (a concurrent sign-up won). */
  insert(row: NewWaitlistSignupRow): Promise<WaitlistSignupRow | null>;
  update(id: string, patch: WaitlistPatch): Promise<void>;
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

  findByUnsubscribeTokenHash(hash: string) {
    return this.findOne(eq(waitlistSignups.unsubscribeTokenHash, hash));
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
}
