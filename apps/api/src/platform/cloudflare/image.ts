import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/** The R2 image a print shows (`imagePick`), as the driver returns the json. */
export interface ImagePick {
  key: string;
  lang: string;
  sibling: boolean;
}

/** `imageUrl` plus, when there is an image, its language and whose image it is (VB-86/VB-87). */
export interface ResolvedImage {
  imageUrl: string | null;
  imageLang?: string;
  imageFrom?: 'print' | 'sibling';
}

/** The languages after the requested one, in this order; the rest alphabetically after them. */
export const IMAGE_LANGS = ['en', 'ja', 'de', 'fr', 'it', 'es', 'pt'];
const LANG_ORDER = sql.raw(`array[${IMAGE_LANGS.map((l) => `'${l}'`).join(',')}]`);

/**
 * Order of the candidates `c` (lang, key, own) of one print: the requested language (and, for the
 * print itself, its own key), then en, ja, de, fr, it, es, pt, the rest; a `-lowres` key after a
 * high-res one of the same step (so the own English high-res scan beats a requested-language
 * lowres one); the requested language's localization before the own key; then by language.
 */
const rank = (lang: SQLWrapper | string, ownIsRequested: boolean) => sql`
  case when c.lang = ${lang}${ownIsRequested ? sql` or c.own` : sql``} then 0
    else coalesce(array_position(${LANG_ORDER}, c.lang), 8) end,
  c.key like '%-lowres.%'`;

/** The keyed images of print `p`: its own key (the English scan) and its localizations' keys. */
const candidates = (id: SQLWrapper, imageKey: SQLWrapper) => sql`(
  select 'en' as lang, ${imageKey} as key, true as own where ${imageKey} is not null
  union all
  select il.lang, il.image_key, false from print_localizations il
  where il.print_id = ${id} and il.image_key is not null
) c`;

/**
 * The R2 image print `p` shows in `lang`, as json `{ key, lang, sibling }`, null without any:
 * the print's own chain (`rank`), else the same chain on another print of its card (same set
 * first, then the newest by the print's date, else its set's). Two correlated subqueries on
 * print_localizations' primary key and prints_card_id_idx; the sibling one only runs for a print
 * without any key (COALESCE).
 * `p`'s columns must be visible to a subquery (`prints` itself, or a CTE's columns).
 * ponytail: the sibling lookup sorts every key of every print of the card (a basic land: hundreds),
 * fine for the few keyless prints; store a per-card best key if keyless prints of such cards grow.
 */
export function imagePick(
  p: { id: SQLWrapper; cardId: SQLWrapper; setId: SQLWrapper; imageKey: SQLWrapper },
  lang: SQLWrapper | string,
): SQL<ImagePick | null> {
  const own = sql`(
    select json_build_object('key', c.key, 'lang', c.lang, 'sibling', false)
    from ${candidates(p.id, p.imageKey)}
    order by ${rank(lang, true)}, c.own, c.lang
    limit 1)`;
  const sibling = sql`(
    select json_build_object('key', c.key, 'lang', c.lang, 'sibling', true)
    from prints sp join sets ss on ss.id = sp.set_id
    cross join lateral ${candidates(sql`sp.id`, sql`sp.image_key`)}
    where sp.card_id = ${p.cardId} and sp.id <> ${p.id}
    order by ${rank(lang, false)}, sp.set_id = ${p.setId} desc,
      coalesce(sp.released_on, ss.released_on) desc nulls last, sp.id, c.own, c.lang
    limit 1)`;
  return sql<ImagePick | null>`coalesce(${own}, ${sibling})`;
}

type Ids = Record<string, unknown> | null | undefined;

/**
 * The image to serve: the picked R2 key, else (no key anywhere, or no image host configured) the
 * first Scryfall source URL of `sources` (the app's CSP blocks those; kept for local dev).
 */
export function resolveImage(
  baseUrl: string,
  pick: ImagePick | null | undefined,
  sources: { lang: string; ids: Ids }[] = [],
): ResolvedImage {
  if (pick && baseUrl) {
    return {
      imageUrl: `${baseUrl}/${pick.key}`,
      imageLang: pick.lang,
      imageFrom: pick.sibling ? 'sibling' : 'print',
    };
  }
  for (const { lang, ids } of sources) {
    const url = (ids?.scryfall_images as { normal?: string } | undefined)?.normal;
    if (url) return { imageUrl: url, imageLang: lang, imageFrom: 'print' };
  }
  return { imageUrl: null };
}
