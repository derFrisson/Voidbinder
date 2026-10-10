# Japanese cards: research and plan (VB-77)

Max wants Japanese cards in the catalog for Magic, Pokémon and Yu-Gi-Oh!, mainly because Japanese
prints are collected actively; images are welcome but secondary. The UI stays German and English.
This document answers how each source carries Japanese cards, how the catalog models them, how
they are searched, and in which order to build it. Every number below comes from a probe made on
2026-10-10 (the commands are summarized under each section) or from a read-only query on the dev
database (`voidbinder_dev` on the VPS). Nothing was written to any database.

## Decision

| Game      | Japanese cards are                                    | Model                                                                           | Why                                                                                                                                                    |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Magic     | printings of the same set and collector number        | **B**: `print_localizations` rows with `lang = 'ja'`                            | All 62,423 Japanese Scryfall printings land on a (set, collector number) that dev already has as a print                                               |
| Pokémon   | separate sets with their own ids, numbering and cards | **A**: new `sets` (`region = 'jp'`), cards, prints, `ja` localizations          | TCGdex lists 186 Japanese sets under their own ids (`SV2a`, `S12a`), zero-padded numbers (`025`) and card counts; no mapping to English sets or cards  |
| Yu-Gi-Oh! | the same cards, printed in separate OCG sets          | **A** for sets and prints, shared `cards`: OCG prints of the existing card rows | A card is one card worldwide (same password), but OCG sets, codes and rarities differ from the TCG (`SD1-JP001`); 220 OCG codes collide with TCG codes |

Option B for everything (Japanese as localizations only) is wrong for Pokémon and Yu-Gi-Oh!: a
Japanese print there has no English print with the same set and number to hang on.

## Per game: source, coverage, probes

### Pokémon: TCGdex `ja`

Probes: `GET https://api.tcgdex.net/v2/ja/sets`, `/v2/ja/series`, all 186 `/v2/ja/sets/{id}`
(paced at about 7 requests per second, all 200, 130 s), sample cards `/v2/ja/cards/{id}`.

- **Sets.** 186 Japanese sets in 14 series (`PMCG`, `neo`, `VS`, `web`, `e`, `ADV`, `PCG`, `L`,
  `XY`, `XYb`, `SM`, `S`, `M`, `SV`), against 220 English ones. Ids are TCGdex's own Japanese set
  codes (`SV1S`, `SV2a`, `S12a`, `M3`), with release dates on all 186. `/v2/ja/sets/sv01` and
  `/v2/en/cards/SV2a-025` answer 404: the two languages share no ids and TCGdex keeps no mapping
  between Japanese and English sets.
- **Collisions with English ids.** Exactly equal: `neo1` to `neo4`, with different contents
  (Japanese `neo1` has 96 cards, English `neo1` 111). Equal ignoring case: 19 (`SM6`/`sm6` …
  `sm12`, `SV10`/`sv10`, `XY2`/`xy2` …). So Japanese sets need their own namespace for `sets.code`.
- **Cards.** The set details list 13,006 cards in 118 sets; 68 sets (most of `ADV`, `L`, `XY`,
  `CS*`, `S1a`–`S5a`) list no cards at all, although `/sets` gives them a `cardCount.total`
  (18,256 summed over all 186). One set (`web1`) is partial (47 of 48). Card ids are
  `<set>-<localId>` with a zero-padded number (`SV2a-025`). A card carries `dexId` (Pikachu: `[25]`,
  same as the English `sv03.5-025`), so the same Pokémon can be found, but not the same card.
  Names, attacks and effects are Japanese; `rarity` is in English (`Common`). Recent cards carry
  `thirdParty` ids (`M3-001`: Cardmarket 867915, TCGplayer 674320).
- **Images.** 3,882 of 13,006 cards (29.8 %) have an image: `SV` 2,875 of 3,677, `S` 1,007 of
  1,796, every other series none. Nothing after `SV10` (April 2025): `SV11B`/`SV11W` and the whole
  `M` series (12 sets to September 2026) are imageless. `high.webp` of `SV2a-025` is 87 KB,
  `low.webp` 20 KB.
- **Rate limits and terms.** No rate-limit headers; the paced crawl never got a 429 or 503. The
  database is MIT-licensed (cards-database README, "Licenses"), the same terms as for `en` and `de`.
  No key or sign-up.

### Magic: Scryfall `lang:ja`

Probes: `GET /cards/search?q=lang:ja&unique=prints&include=extras`, all 357 pages (62,423 objects),
`/bulk-data`; dev: `print_localizations` by game and language, every Magic (set, number).

- **Printings.** 62,423 Japanese printings in 277 sets, each a card object of its own with the same
  set and collector number as the English one. All 62,423 match a (set, collector number) that dev
  already has as a print, so Magic needs no new sets or prints. There are no Japanese-only sets
  outside what dev already holds: the Japanese-only printings (War of the Spark ★ alternate art,
  Mystical Archive JP `sta`/`soa`, Premiere Shop promos `pmps*`, `bchr`, `jp1`, `pjjt`) are already
  prints, because `default_cards` contains their Japanese object when no English one exists.
- **Where the 617 `ja` rows on dev come from.** Exactly those: `importCardLines` writes each
  `default_cards` object's own-language localization, and for a Japanese-only print that is `ja`
  (`soa` 130, `bchr` 125, `sta` 63, `pmei` 47, `pwcs` 46, `war`/`pwar` 36 each, …). All 617 prints
  have `ja` and no `en` row. `all_cards` is filtered to `SCRYFALL_LANGUAGES` minus `en` (today
  `de`), so no other `ja` rows exist.
- **Bulk files.** `default_cards` is one object per print in English or, failing that, the printed
  language (79 MB compressed); `all_cards` holds every language (395 MB compressed). The importer
  already downloads and splits `all_cards` for `de`; adding `ja` only lets more lines through
  `langFilter`.
- **Images.** `image_status` of the 62,423: `highres_scan` 7,506 (12.0 %), `lowres` 46,282
  (74.1 %), `placeholder` 8,628 (13.8 %), `missing` 7. The mirror copies only high-res scans
  (`sourceUrl` in `src/import/images.ts`), so about 7,500 images go to R2. Only those show Japanese
  art: `imageUrl` (`drizzle-card-store.ts`) puts the print's English R2 key ahead of the localized
  source URL, because the app renders only our image host. The other 54,900 Japanese printings (the
  46,282 low-res scans, the placeholders and the missing ones) show the English print's image.
- **Prices.** 1,543 of the 62,423 Japanese objects carry any price; most have none. 592 of them
  are Japanese-only prints, which `default_cards` already prices today. The other 951 are
  Japanese printings of prints that have an English object (`ltr` 235, `40k` 161, `ltc` 100, …);
  `prices_current` has no language dimension, so those stay out, as the German ones do today.

### Yu-Gi-Oh!: YGOPRODeck `ja` and Yugipedia

Probes: YGOPRODeck `cardinfo.php?id=46986414&language=ja` and `language=jp`, the full
`cardinfo.php?language=ja` dump against the English one, `?misc=yes`; Yugipedia `api.php`
(`action=ask` over the Semantic MediaWiki data, `list=categorymembers`, `meta=siteinfo`);
db.ygoresources.com `/data/card/4041` and `/data/idx/card/name/ja`; dev: Yu-Gi-Oh! set codes.

- **YGOPRODeck `language=ja` carries the Japanese card text (chosen for names and lore).**
  `cardinfo.php?id=46986414&language=ja` answers 200 with `name` `ブラック・マジシャン`, a Japanese
  `desc` and `name_en` `Dark Magician`. The full `cardinfo.php?language=ja` dump answers 200 with
  11,646 cards in one request (24.6 MB; the English dump has 14,599 cards, 21.3 MB). Every `id` is
  also in the English dump, so it is the `id` we already use as `cards.oracle_key`; 11,593 of the
  cards have kanji or kana in `name`, 11,639 in `desc`, and 12 repeat `name_en` as `name`. The
  2,953 English cards missing from the `ja` dump have no Japanese text there. Only `language=jp`
  answers 400 ("This API accepts the following language values: 'fr', 'de', 'it' or 'pt'"; the
  message omits `ja`, but the value works). A name lookup with an English name,
  `name=Dark Magician&language=ja`, answers 400 "No card matching your query was found", so look
  cards up by `id` or take the dump. Its `card_sets` lists TCG prints only and `misc_info` has
  `ocg_date` and `konami_id`, so the dump has no OCG set, code or rarity.
- **Yugipedia (chosen for the OCG set lists, and for cards YGOPRODeck lacks).** Licensed CC BY-SA
  (`meta=siteinfo&siprop=rightsinfo`: "Creative Commons Attribution Share Alike"); the API is
  reachable without the Cloudflare challenge that guards the wiki pages. Two kinds of data:
  - _Set lists_: the category "Japanese Set Card Lists" has 1,849 pages
    (`Set Card Lists:<set> (OCG-JP)`), each with `Release date`, `Local_name` (Japanese, with ruby
    markup) and one subobject per entry with `Card number` (`SD1-JP001`), `Rarity` (one or more)
    and `Set contains` (the card page). Without Rush Duel (`RD/…` codes): 1,503 pages, 32,198
    entries, **42,432 prints** (entry × rarity), **14,786 cards**, 855 code prefixes, 1,045 entries
    without a number (unnumbered promos). Pulling all of it took 56 `ask` queries in 208 s at one
    query per 1.2 s.
  - _Card pages_: `Japanese name`, `Japanese kana name` (reading), `Romaji name`, `Japanese lore`,
    `Password` and `Database ID` (Konami's id). `Password` is YGOPRODeck's card id, which is our
    `cards.oracle_key`. The importer reads a card page only for a card the `ja` dump lacks: a
    title match of the set lists' card pages against the dump's `name_en` finds 11,237 of 17,097
    titles; the other 5,860 are the upper bound (disambiguated titles such as `Token (card)`,
    tokens, anime cards, and 2,521 that exist in the English dump but not in the `ja` one, for
    example `Diabellstar the Black Witch`). The importer joins on `Password`, not on titles, and
    reports the real number.
  - Limit: Semantic MediaWiki ignores an `offset` above roughly 5,000 and starts again from the
    first row, so a crawl must partition its queries (the probe used half-year windows of the set
    list's release date; none came near the cap).
- **Set codes collide.** 220 of the 855 OCG code prefixes (lowercased, as `sets.code` stores them)
  are TCG set codes on dev (`sd1`, `bpro`, `agov`, `ch01`, …), often for different contents.
  Several pages share a prefix (`VJMP` on 227 promo pages, `WJMP` 25): they merge into one set, as
  anniversary editions do in the TCG import.
- **Rejected sources.** db.ygoresources.com has Japanese names, readings, text and print codes per
  card, but presents itself as "access to KONAMI's database" and states no license; the official
  Konami database has no API and is not scraped. YGOPRODeck's `cardsetsinfo` covers TCG sets only.
- **Images.** None. Yugipedia's card images are scans uploaded under fair use, not CC BY-SA, and
  YGOPRODeck has TCG images only. A new OCG print row has no image key and no source URL, and
  `imageUrl` looks only at the print's own key and its localization's, so as the code stands it
  would show no image: the English art lives on the TCG print rows, not on the card. Step 5 adds
  the fallback: the three queries that call `imageUrl` (set page, card page incl. the print endpoint sharing `printDetails`, search) take the image
  of another print of the same card (a lateral pick by `card_id`, one print with an image key) when
  the print has none. An OCG-only card has no other print and stays without an image.
- **Prices.** None: TCGCSV has no OCG category (`/tcgplayer/categories`: 1 Magic, 2 YuGiOh,
  3 Pokemon, 85 Pokemon Japan), and no other source we use carries OCG prices.

## Schema delta (migration 0009, additive)

```sql
-- Search for Japanese names (pg_trgm ships with every image we use and is a trusted extension:
-- voidbinder_migrate holds CREATE on both databases, checked on dev).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 'intl' for every existing set, 'jp' for Japanese sets (Pokémon from TCGdex ja, Yu-Gi-Oh! OCG).
ALTER TABLE "sets" ADD COLUMN "region" text DEFAULT 'intl' NOT NULL;
ALTER TABLE "sets" ADD CONSTRAINT "sets_region_check" CHECK ("region" IN ('intl', 'jp'));

CREATE INDEX "print_localizations_name_trgm_idx" ON "print_localizations"
  USING gin ("name" gin_trgm_ops);
```

Nothing else changes: `cards`, `prints` and `print_localizations` already have what a Japanese
print needs, and `sets_game_id_code_key` stays the URL key.

- **Set codes.** A Japanese set's code is the source code, lowercased, plus `-jp`: Pokémon
  `sv2a-jp`, Yu-Gi-Oh! `sd1-jp` (reads like the printed `SD1-JP001`). Lowercase is the catalog's
  convention (all 1,647 set codes on dev, in all three games) and the set route requires it: it
  lowercases the code before the lookup (`code.toLowerCase()`, `apps/api/src/routes/catalog.ts`), so
  a mixed-case `SV2a-jp` would answer 404. The source id keeps its original case in `external_ids`
  (`tcgdex: 'SV2a'`, `set_code: 'SD1'`), and TCGdex answers its Japanese routes for the lowercased
  id too (`/v2/ja/sets/sv2a` and `/v2/ja/cards/sv2a-025` are 200). No two of the 186 Japanese ids
  become equal when lowercased, and the `-jp` suffix rules out every collision with the 220
  Yu-Gi-Oh! and 19 Pokémon clashes above, so `/catalog/sets/:game/:code` needs no region
  parameter.
- **Pokémon card identity.** `cards.oracle_key` = `ja:` + the TCGdex id (`ja:SV2a-025`), so a
  Japanese card can never take an English card's key (`neo1-001` and `neo1-1` differ only by
  padding). `cards.name` holds the Japanese name, the only name the source has; the print gets a
  `ja` localization. The print's `number` is TCGdex's `localId` as printed (`025`).
- **Yu-Gi-Oh! prints.** One print per OCG code and rarity (`variant` = rarity slug), on the card
  whose `oracle_key` is the page's `Password`, with a `ja` localization (Japanese name and lore).
  Entries without a number are skipped and counted, as the TCG import does with cards in no set.
- **`catalog_version` and ETags** need nothing new: every import already bumps the version, and the
  ETag hashes the body.
- **Sync** (ADR 0005) keys on print ids, which are stable UUIDs; new prints are just new rows.
  Collection entries already carry `language`, so a Japanese Magic card is the English print with
  `language = 'ja'`, a Japanese Pokémon or OCG card a Japanese print with `language = 'ja'`.

## Search

Today: `cards.search` and `print_localizations.search` are `to_tsvector('simple', …)`, which splits
on spaces and punctuation only. Japanese has no spaces, so a name is one token: on dev,
`to_tsvector('simple', '黒魔導の覇者')` is the single lexeme `'黒魔導の覇者'`, so `覇者` finds
nothing there, while a whole name (`ピカチュウ`) and a name's start (`ピカ:*`, the existing prefix
rule) still match. Middle-of-name queries, the usual way a Japanese name is searched, fail.

Options:

| Option                                      | Verdict                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_trgm` GIN on `print_localizations.name` | **Chosen.** Available on the VPS image (`pg_available_extensions`: `pg_trgm` 1.6, trusted), works on CJK under the databases' `C.UTF-8` locale |
| `pg_bigm`, PGroonga                         | Not in `timescale/timescaledb-ha:pg18.6-ts2.30.2` (only `pg_trgm`, `rum`, `unaccent`, `vector` of the candidates)                              |
| Reading (kana) or romaji column             | Later, as an addition: Yugipedia has `Japanese kana name` and `Romaji name`, TCGdex has neither                                                |
| External search engine                      | Not in the stack (ADR 0001)                                                                                                                    |

**Measured probe.** `pg_trgm` is available on dev but not installed, and installing it is a write,
so the probe ran on a throwaway local container of the exact VPS image
(`timescale/timescaledb-ha:pg18.6-ts2.30.2`, `--locale=C.UTF-8`, as dev): 432,082 names, which are
dev's 286,225 `print_localizations` names (read with `\copy … to stdout`) plus 145,857 Japanese
names (all 62,423 Scryfall `ja` printings, the 13,006 TCGdex `ja` cards, the YGOResources Japanese
name index three times over as a stand-in for OCG prints). `show_trgm('黒魔導の覇者')` yields 7
trigrams; the GIN index built in 0.8 s and is 26 MB (the `simple` tsvector index 13 MB, the table
44 MB). `EXPLAIN ANALYZE … where name ilike '%q%'`:

| Query                          | Plan                        | Rows  | Time    |
| ------------------------------ | --------------------------- | ----- | ------- |
| `%マジシャン%` (5 chars)       | Bitmap Index Scan, trgm GIN | 351   | 0.65 ms |
| `%ピカチュウ%` (5 chars)       | Bitmap Index Scan, trgm GIN | 99    | 0.19 ms |
| `%pikachu%` (Latin, for scale) | Bitmap Index Scan, trgm GIN | 397   | 0.66 ms |
| `%覇者%` (2 chars)             | Parallel Seq Scan           | 19    | 44.9 ms |
| `%竜%` (1 char)                | Parallel Seq Scan           | 1,685 | 43.9 ms |
| `lang = 'ja'` and `%覇者%`     | Parallel Seq Scan           | 19    | 11.9 ms |

Three or more characters use the index; one or two characters cannot (a trigram needs three) and
fall back to a scan, 12 to 45 ms at this size, which Hyperdrive and the edge cache then hold. That
ceiling is acceptable; `pg_bigm` would remove it but is not available.

**Rule for the search route.** When `q` contains Han, Hiragana or Katakana (`\p{Script=Han}`,
`\p{Script=Hiragana}`, `\p{Script=Katakana}`), the localization branch of the union uses
`print_localizations.name ILIKE '%' || q || '%'` (with `%` and `_` escaped) instead of the
tsquery, plus `lang = 'ja'` for queries under three characters; every other query is unchanged.
The rank is 1 for a name match; ties keep the existing order.

**Offline modules.** `names_fts` keeps `unicode61`. node:sqlite (SQLite 3.53.0) checked: FTS5
`unicode61` finds `ピカチュウ*` but not `覇者` inside `黒魔導の覇者`; the `trigram` tokenizer has
the same three-character floor as `pg_trgm`. A plain `name LIKE '%覇者%'` over the 145,857
Japanese names took 9 ms in node:sqlite on the workstation, so the app's future module
reader should use `LIKE` on `print_localizations` for a query with CJK characters and no extra FTS
table.

## Prices

- **Pokémon:** TCGCSV has category 85 "Pokemon Japan" with 461 groups; group abbreviations equal
  TCGdex's Japanese set ids for 85 of the 118 sets with cards (9,623 of 13,006 cards; the old
  `PMCG`, `neo`, `PCG`, `E` sets do not match). `SV2a` has 516 card products, 514 with a
  `marketPrice`, subtypes `Normal` and `Holofoil`, numbers as `001/165`, and English names (group
  `SV2a: Pokemon Card 151`, product `Bulbasaur - 001/165`). The existing `number_match` (same set,
  same number, compared without the `/165` and leading zeros) maps them. About 920 more requests a
  day (461 groups × products and prices), so a TCGCSV run stays well under its 10,000 a day.
- **Cardmarket does list Japanese Pokémon** (TCGdex `ja` cards carry `cardmarket` product ids and
  Cardmarket price blocks), but there is no Cardmarket source for Pokémon in Voidbinder today and
  TCGdex's prices are never imported; nothing changes there.
- **Magic:** nothing to add (see above): the Japanese-only prints are already priced through
  `default_cards`; a price per language of the same print is out of scope (no language dimension in
  `prices_current`).
- **Yu-Gi-Oh! OCG:** no source.

## Size and duration

| Game      | New rows                                                                                     | Postgres    | Images to R2                      | Import time                                                                                             |
| --------- | -------------------------------------------------------------------------------------------- | ----------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Magic     | 62,423 `print_localizations`                                                                 | about 60 MB | about 7,500 (high-res scans only) | the daily run grows by one or two minutes (more `all_cards` lines)                                      |
| Pokémon   | 118 sets with cards (+ set localizations), 13,006 cards, 13,006 prints, 13,006 localizations | about 50 MB | 3,882                             | full: about 13,200 requests, 25 min at 9/s; daily: a few hundred                                        |
| Yu-Gi-Oh! | about 860 sets, about 42,400 prints, 42,400 localizations                                    | about 80 MB | none                              | one YGOPRODeck `ja` request plus about 4 min of Yugipedia set-list queries; card pages only for the gap |

Row sizes are dev's averages (`pg_column_size`: a `ja` localization row 952 B with its tsvector,
prints 477 to 852 B), rounded up for the indexes, including the new trigram index (about 26 MB at
432,000 names, so about 40 MB once every language is in).

Images: about 11,400 files; at 87 KB (`high.webp`) or about 120 KB (Scryfall `large`) plus a
15 KB `sm` copy that is about 1.3 GB in R2, about 0.02 USD a month at R2's storage price, and the
writes stay inside the free operations. The mirror's rates (`SOURCE_RATES`: Scryfall 20/s,
TCGdex 8/s) make the bulk load about 6 min for Magic and 8 min for Pokémon.

Offline modules (gzip sizes from `GET /catalog/modules` on dev, version 9: Pokémon 11.3 MB,
Yu-Gi-Oh! 19.8 MB, Magic 47.2 MB). Estimated from the current bytes per print: Pokémon plus
about 4 to 5 MB, Yu-Gi-Oh! plus about 8 MB (42,400 prints with one localization each), Magic plus
about 9 MB (62,400 localizations with Japanese text, which compresses less than Latin text).

## App impact

- **Set page:** the language chips already come from `facets.languages` (the languages of the set's
  `print_localizations`), so `JA` appears by itself on Magic sets once the rows exist. On a
  Japanese set (`region = 'jp'`) the app opens with `lang = 'ja'`, since its prints have no `de` or
  `en` names; the chips are then print languages, not UI languages.
- **Set list:** `GET /catalog/games/:game/sets` returns `region` and takes `?region=`; Pokémon and
  Yu-Gi-Oh! get two chips, International and Japan (Magic has no Japanese sets). Set names:
  Japanese sets get an `en` name where one exists (TCGCSV's group name for Pokémon, the Yugipedia
  page title for OCG sets) and the Japanese one as the `ja` localization; `sets.name` stays the
  English name, falling back to the Japanese one. One importer writes it per game and set (the
  TCGdex `ja` pass for Pokémon, taking the English name from TCGCSV's group list; the Yugipedia pass
  for OCG sets), so no two importers upsert the same `sets.name`. The list's default is
  `region=intl` (see step 1).
- **Card page:** lists every print of the card, so Yu-Gi-Oh! OCG prints show up next to the TCG
  ones without a change. Japanese Pokémon cards are cards of their own and list only their print.
- **Collection:** an entry already carries `language` (default `en` in `POST /entries`); the app
  sends `ja` when the print belongs to a Japanese set.
- The UI language stays `de`/`en`; nothing in `src/i18n` beyond the new chip labels.

## Risks

- **TCGdex `ja` is incomplete:** 68 of 186 sets list no cards and no set after April 2025 has
  images. The importer skips sets without cards (they would be empty pages) and picks them up when
  TCGdex fills them (the incremental run already refetches sets whose card count changed).
- **Yugipedia is a wiki:** the OCG set lists change by hand and the SMW offset cap needs
  partitioned queries. Each run keeps the raw answers in `RAW` as the other importers do, and a set that
  disappears from the source stays in the catalog, as today.
- **OCG-only cards:** a Yugipedia card whose `Password` is unknown to YGOPRODeck (or that has no
  password) has no card row to attach to, and a card in the English dump but not in the `ja` dump
  has a card row but no Japanese text from YGOPRODeck. Step 2 counts both before deciding whether
  to create cards keyed `konami:<Database ID>`, to read the Japanese name from the card page, or to
  skip and list them like `codeConflicts`.
- **Short Japanese queries** (one or two characters) scan instead of using the index: 12 to 45 ms
  measured at 432,000 names, growing linearly.
- **Pokémon JP names** are Japanese only; someone who reads no Japanese finds a Japanese card by
  set and number, or by the English TCGplayer name once that is added (follow-up below).

## Build plan

Each step is one PR and leaves `main` working.

1. **Schema, set-list API and the Magic and Pokémon importers.** Migration 0009 (above) with its
   Drizzle schema change, and with it `region` in `SetSummary` and `?region=` on
   `GET /catalog/games/:game/sets`, default `intl`: an older app build sends no region and so sees
   exactly the international sets it sees today, and the Japanese sets only appear to a build that
   asks for `region=jp`. (Search and the card page return Japanese prints from this step on, with
   their Japanese set (English name from TCGCSV where one exists), as any print.) `SCRYFALL_LANGUAGES=en,de,ja` in all three envs of `wrangler.jsonc`. TCGdex: a second
   pass with `ja` as the master language (`/v2/ja/sets`, codes `<lowercased id>-jp`, `region = 'jp'`,
   `oracle_key` `ja:<id>`, sets without cards skipped); the plan, rotation and missing-card logic
   reused per region. This pass is the only writer of a Japanese Pokémon set's `sets.name`: it reads
   TCGCSV's one group list for category 85 (`/tcgplayer/85/groups`, one request) and takes the
   English name from the group whose abbreviation equals the TCGdex id (`SV2a: Pokemon Card 151`
   gives `Pokemon Card 151`), the TCGdex Japanese name where no group matches, and writes the
   Japanese name as the set's `ja` localization. Step 4 then only matches prices and writes no set
   names, so `sets.name` has one writer. `setStates` (`import/tcgdex/write.ts`) is keyed by code
   across the whole game, so each pass filters by region (or the `-jp` suffix) or it sees the other pass's sets. The
   comment on `cards.name` ("English canonical name") changes: for a Japanese Pokémon card it holds
   the Japanese name. Tests with fixtures from the probe (`SV2a`, `neo1` for the collision).
2. **Yu-Gi-Oh! OCG importer.** `src/import/yugipedia/` with the YGOPRODeck shape. Japanese names and
   lore come from one YGOPRODeck `cardinfo.php?language=ja` request (keyed by the `id` we already
   use as `oracle_key`) and are written as `ja` localizations on the OCG prints only, never on the
   TCG prints. Yugipedia supplies the OCG set lists (code, rarity, card link, release date, in
   half-year windows) and the English set title (`sets.name`, the Japanese title as the `ja` set
   localization), and a card page only for a card YGOPRODeck lacks. Raw answers to `RAW`, codes
   `<prefix>-jp` (lowercased), one print per code and rarity on the existing cards, a Workflow,
   cron and `POST /admin/import/yugipedia`; CC BY-SA attribution where the app credits sources.
   Report the OCG-only and the no-Japanese-text card counts (Risks). Effort: the set lists, about
   56 queries and 4 minutes; no card-page crawl of all 14,800 cards.
3. **Image mirror.** Nothing to code: `ja` localizations and Japanese prints carry the source URLs
   the mirror already reads. Run the bulk load on the VPS once steps 1 and 2 are on prod.
4. **Prices.** TCGCSV category 85 in the TCGCSV import, matched to `region = 'jp'` Pokémon sets by
   abbreviation (number match as today).
5. **Search and images.** The CJK branch of `search` (above); the image fallback to another print
   of the same card for prints without one (OCG prints, see Images above); tests on a Japanese
   fixture and on an OCG print.
6. **App.** Region chips on the Pokémon and Yu-Gi-Oh! set lists, `lang = 'ja'` default on Japanese
   sets, `ja` default language when collecting a Japanese print, CJK search through the API.
7. **Offline modules.** `LANGS` gains `ja`, `sets` gains `region` (`SCHEMA_VERSION` 2,
   `MIN_APP_SCHEMA_VERSION` stays 1 because the change is a new column). The app has no module
   reader yet (`apps/app/src` has none), so this is a requirement for the reader once it exists: a
   query with CJK characters searches `print_localizations` with `LIKE`, not the FTS table.

## What needs Max

Nothing blocks the work. TCGdex `ja` needs no key, sign-up or agreement (MIT, same API). One
decision to confirm in step 2: Yugipedia's data is CC BY-SA, so the OCG set-list data (set titles,
codes, rarities, release dates, and any card page read for the gap) needs an attribution line (with
a link to the license) wherever Voidbinder credits its sources, and redistributing it (the offline
modules) keeps it under CC BY-SA. The Japanese names and lore from YGOPRODeck fall under the
YGOPRODeck terms we already rely on, not under CC BY-SA.

## Follow-ups (not part of VB-77)

- English names for Japanese Pokémon prints from TCGplayer's product names (`Bulbasaur - 001/165`),
  once the price mapping links them, so the cards can be found in English.
- A reading column (kana) for Yu-Gi-Oh! from Yugipedia's `Japanese kana name`, so `くろまどう`
  finds `黒魔導`; hiragana/katakana folding for search.
