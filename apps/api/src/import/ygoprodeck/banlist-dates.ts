import { sql } from 'drizzle-orm';
import { appMeta } from '../../db/schema';
import { USER_AGENT, type Fetch } from '../scryfall/source';
import type { Db } from './write';

// The effective date of the current Forbidden & Limited Lists (VB-81). YGOPRODeck's `banlist_info`
// carries the statuses but no date (checked 2026-10-10: neither `cardinfo.php?banlist=` nor
// `misc_info` nor `checkDBVer.php` has one), so the date comes from Yugipedia's Semantic
// MediaWiki: one `action=ask` per list for its newest "Effective date" (a fact, credited in the
// app as "Yugipedia"). Two requests per run.

const LISTS = {
  tcg: { category: 'TCG Advanced Format Forbidden & Limited Lists', suffix: '(TCG)' },
  // The OCG category also holds the Korean lists.
  ocg: { category: 'OCG Forbidden & Limited Lists', suffix: '(OCG)' },
} as const;

export type BanlistDates = Partial<Record<keyof typeof LISTS, string>>;

export const banlistDatesUrl = (format: keyof typeof LISTS) =>
  `https://yugipedia.com/api.php?action=ask&format=json&query=${encodeURIComponent(
    `[[Category:${LISTS[format].category}]]|?Effective date|sort=Effective date|order=desc|limit=10`,
  )}`;

interface AskAnswer {
  query?: {
    results?: Record<string, { printouts?: { 'Effective date'?: { timestamp?: string }[] } }> | [];
  };
}

/**
 * The newest effective date of each list on or before `today` (an announced list that is not in
 * force yet does not count). A list whose answer fails or has no date is left out.
 */
export async function fetchBanlistDates(fetchFn: Fetch, today: string): Promise<BanlistDates> {
  const dates: BanlistDates = {};
  for (const format of Object.keys(LISTS) as (keyof typeof LISTS)[]) {
    const res = await fetchFn(banlistDatesUrl(format), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) continue;
    const results = ((await res.json()) as AskAnswer).query?.results;
    // An empty result set comes as `[]`.
    const found = Object.entries(Array.isArray(results) ? {} : (results ?? {}))
      .filter(([title]) => title.endsWith(LISTS[format].suffix))
      .flatMap(([, r]) => {
        const ts = Number(r.printouts?.['Effective date']?.[0]?.timestamp);
        return Number.isFinite(ts) && ts > 0
          ? [new Date(ts * 1000).toISOString().slice(0, 10)]
          : [];
      })
      .filter((d) => d <= today)
      .sort();
    const newest = found.at(-1);
    if (newest) dates[format] = newest;
  }
  return dates;
}

/** `app_meta.banlist_<format>_effective` for each date found; an unknown one keeps the old row. */
export async function writeBanlistDates(db: Db, dates: BanlistDates) {
  const rows = Object.entries(dates).map(([format, value]) => ({
    key: `banlist_${format}_effective`,
    value,
  }));
  if (!rows.length) return;
  await db
    .insert(appMeta)
    .values(rows)
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: sql`excluded.value`, updatedAt: sql`now()` },
      setWhere: sql`${appMeta.value} is distinct from excluded.value`,
    });
}
