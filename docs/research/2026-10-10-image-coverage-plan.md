# Card image coverage: strategy and plan (2026-10-10)

This plan draws on two reports: the gap report ([2026-10-10-image-coverage-gaps.md](2026-10-10-image-coverage-gaps.md): what is missing and why) and the source research ([2026-10-10-image-sources.md](2026-10-10-image-sources.md): who else has the images and on which terms). It covers the fallback chain per game, the one fix to build now, what needs Max, and the Jira tickets for everything else (VB-84 to VB-94). None of this is legal advice. The rights in the card art sit with Wizards, The Pokémon Company and Konami whatever the source. This plan only looks at what each source's own terms allow on top of that.

## Where we stand

| game    |  prints | without image | cause in one line                                                                                                                 |
| ------- | ------: | ------------: | --------------------------------------------------------------------------------------------------------------------------------- |
| mtg     | 103,435 |         3,635 | Scryfall has the image but flags it `lowres` (3,066) or `placeholder` (569); our mirror only takes `highres_scan`                 |
| pokemon |  21,290 |         1,627 | TCGdex has no image (1,106), another language has it (457), a file TCGdex does not declare (61), or a declared file that 404s (3) |
| yugioh  |  44,266 |             0 | no image gap; the gap is localized names (2,508 cards without `de`) and localized set codes (none stored)                         |

Max's two Pokémon examples, explained:

- **30th Celebration Mew B / G / R:** this is not an importer bug. The prints exist with the right number. TCGdex declares `https://assets.tcgdex.net/en/me/30th/B`, but it never uploaded the file: every language answers 404, while card 001 of the same set answers 200. Our mirror tries the URL, gets the 404, and retries daily. Two fixes: pokemontcg.io has the cards as `me55-B/G/R` (VB-84, waits on Scrydex), or TCGdex uploads the files (upstream report, VB-90).
- **30th Classic Collection (30 prints):** TCGdex declares no image for any card. pokemontcg.io has 28 of the 30 as `me55c` (VB-84).

## Strategy per game

Each fallback chain is ordered. Images are always mirrored to R2 under the primary source's id (`images/<game>/<source id>/<lang>/…`), never hotlinked (our CSP allows only `img.voidbinder.de`). A source enters the chain only if its terms allow self-hosting.

### Magic: The Gathering

1. Scryfall `highres_scan` (today).
2. **Scryfall `lowres` (build now).** Mirroring is already allowed, and Scryfall's image terms make no distinction by `image_status`. Store it under its own file names (`orig-lowres.jpg`, `sm-lowres.webp`) so the later high-res scan is not hidden behind the one-year `immutable` cache, and re-mirror the row once `highres_image` turns true. Closes 3,066 prints.
3. The same card's scan from another printing, for the 569 `placeholder` prints (all have one) (VB-87, Max decides between this, Scryfall's "Localized Image Not Available" image, and our own placeholder).
4. Our placeholder.

Localizations: a German Magic localization without its own key shows the print's English high-res scan today. Scryfall has a `lowres` German scan for 42,480 of them. Whether to show that instead is a product call (VB-88). The top fix leaves localizations on the high-res-only rule.

### Pokémon

1. TCGdex `card.image` in the print's language (today).
2. TCGdex conventional asset URL when `card.image` is absent but the file exists (61 prints, VB-85). Same source, no new terms.
3. pokemontcg.io legacy data / Scrydex image hosts (858 prints, including Mew B/G/R and the whole-set gaps Shiny Vault, Dragon Majesty, Galarian Gallery, Trainer Galleries) (VB-84). **Blocked on Max:** Scrydex's terms forbid mirroring "the Services" without written authorization ("Resell, sublicense, redistribute, mirror, or commercially exploit the Services without prior written authorization from Scrydex"), while their best-practices page recommends "Hosting the images yourself (e.g., on your own Content Delivery Network (CDN))". One email settles it.
4. Another language's TCGdex scan (457 prints: 85 already stored as `de`, 372 need `es`/`it`/`fr` imported) (VB-86, product call: it shows foreign text on an English print). 87 of the 457 are also covered by step 3.
5. Our placeholder. About 611 prints have no source with clean terms: MEP, My First Battle, BW to SM trainer kits, McDonald's 2014/15/17/18/23/24, SVP 166+. The paid Scrydex plan ($29/month) may cover some of them; that is part of VB-84's question.

Not in the chain:

| source                           | why not                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| TCGplayer CDN                    | its terms forbid use outside TCGplayer without written permission and forbid scraping |
| Cardmarket                       | no API access for new applicants                                                      |
| pokemon.com and pokemon-card.com | personal, non-commercial use only                                                     |
| Limitless TCG                    | one person's scans, no licence, no ids we hold                                        |
| Malie.io                         | datamined from the game client                                                        |

Quotes are in the source research §1.3 to §1.7.

### Yu-Gi-Oh!

Images: YGOPRODeck, mirrored, complete. Nothing to do. Localized copies share the EN image (Max's decision).

Localized data, on Max's model: no new print rows. Each language is a `print_localizations` row holding name, text and `external_ids.set_code` (`BLGG-DE024`).

1. Names and texts: YGOPRODeck `language=<l>` (today, de 11,769 of 14,599 cards), then Yugipedia for the rest and for FR/IT/ES/PT (VB-93). **Blocked on Max:** Yugipedia text is CC BY-SA 4.0. It needs attribution, and someone has to decide whether ShareAlike reaches the catalog. The Konami database terms are unread.
2. Localized set codes: seed them by rule (`-EN` → `-DE`/`-FR`/`-IT`/`-SP`/`-PT`, or insert the token for early codes such as `LON-065` → `LON-DE065`; 84 % exact for DE, 62 % for PT), then confirm against Yugipedia's per-language set lists (VB-94, same legal gate). That adds about 175,000 localization rows. VB-79 already builds search keys by rule.

## Decision table

| #   | change                                                                                               |                                   prints | source / terms                           | status                                     | ticket   |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------: | ---------------------------------------- | ------------------------------------------ | -------- |
| 1   | Mirror Scryfall `lowres` scans for prints, under `-lowres` key names, upgraded when the scan arrives |                                    3,066 | Scryfall, mirroring allowed              | **build now**                              | this run |
| 2   | Pokémon pokemontcg.io / Scrydex fallback (incl. Mew B/G/R, 30th-c)                                   |                                      858 | Scrydex terms: "mirror" needs written OK | needs Max (email)                          | VB-84    |
| 3   | MTG placeholder prints: sibling print's scan or Scryfall's badge image                               |                                      569 | Scryfall                                 | built (sibling scan)                       | VB-87    |
| 4   | Pokémon other-language scan for English prints, import es/it/fr                                      |                                      457 | TCGdex (MIT data)                        | built (API fallback; es/it/fr import open) | VB-86    |
| 5   | TCGdex conventional URL when `card.image` is absent                                                  |                                       61 | TCGdex                                   | ready to build                             | VB-85    |
| 6   | MTG lowres scans for localizations (de 42,480)                                                       | 0 keyless prints; changes language shown | Scryfall                                 | needs Max (product)                        | VB-88    |
| 7   | Remember permanent 404s (daily run shows `failed: 14`)                                               |                                        0 | n/a                                      | ready to build                             | VB-89    |
| 8   | Report the six declared-but-missing TCGdex files upstream                                            |                                    3 + 3 | TCGdex                                   | needs Max's go (public GitHub issue)       | VB-90    |
| 9   | Set `card_count` falls back to `total` when `official` is 0 (mep, 30th-c)                            |                                   2 sets | TCGdex                                   | ready to build                             | VB-91    |
| 10  | Scryfall `/bulk-data` 429 fails the whole daily import: back off                                     |                                        0 | Scryfall                                 | ready to build                             | VB-92    |
| 11  | Yu-Gi-Oh! names and texts from Yugipedia (2,508 cards without `de`, plus FR/IT/ES/PT)                |                                        0 | Yugipedia CC BY-SA 4.0                   | needs Max (legal)                          | VB-93    |
| 12  | Yu-Gi-Oh! localized set codes on `print_localizations`                                               |                       about 175,000 rows | rule + Yugipedia                         | needs Max (legal, same as 11)              | VB-94    |
| 13  | TCGplayer CDN, Cardmarket, pokemon.com, Limitless, Malie                                             |                                          | terms forbid or no grant                 | rejected                                   | none     |

Why #1 is the fix to build now:

- It closes the most gaps: 3,066 of 5,262 keyless prints across all games, 58 %.
- It uses a source we already mirror under terms we already checked, so there is no new legal exposure.
- It is one condition plus a key-naming rule in a single shared module.

The Mew case is not an importer bug, so it does not belong in this fix (see above).

## Top fix: build brief (mirror Scryfall lowres scans)

**Behaviour.** A Magic **print** row whose `external_ids.scryfall_images.image_status` is `lowres` (and `highres_image` false) is mirrored like a high-res one. Its objects are named `images/mtg/<scryfall id>/<lang>/orig-lowres.jpg` and `sm-lowres.webp`, and `image_key` gets one of those keys. When a later Scryfall import sets `highres_image` to true, the row becomes pending again: the mirror downloads the scan to `orig.jpg` / `sm.webp` and replaces the key. `placeholder` and `missing` stay keyless. Localization rows keep the high-res-only rule (VB-88). A print's `en` localization keeps no key, and the API falls back to the print's key, so the picture is the same.

**Files to touch:**

- `apps/api/src/import/images.ts`, the only logic file:
  - `sourceUrl(game, ids, opts?)`: for `mtg`, also accept `image_status === 'lowres'` when the caller allows it (prints only). The `errors.scryfall.com` guard stays.
  - Key naming: a lowres job gets the sizes `orig-lowres` / `sm-lowres`. Widen `ImageSize` or add a suffix to `imageKey`; keep `ImageJob.keys` as `{ orig, sm }`.
  - `planJobs`: knows `target.table`, so it passes the allow-lowres flag and picks the lowres names. A lowres row and a high-res row never share a URL.
  - `hasSm`: true for `/sm.webp` and `/sm-lowres.webp`.
  - `needsWork` (SQL, must stay equal to `sourceUrl`): in the prints select only, `mirrorable` also holds for `game = 'mtg' and image_status = 'lowres'`. The "todo" part becomes:
    - key is null, or
    - with `sm`, the key is not an `sm` key of either name (today's `not like '%/sm.webp'` would re-queue `sm-lowres` keys forever), or
    - the key is a `-lowres` key and `highres_image` is now true (the upgrade).
  - Give `needsWork` a parameter for the table instead of duplicating it.
  - `writeKeys` `replaceable`: replace when the new key ranks higher. The ranks, highest first: `sm.webp`, `orig.<ext>`, `sm-lowres.webp`, `orig-lowres.jpg`. That keeps today's orig→sm upgrade and adds lowres→high-res. Never downgrade.
- `apps/api/src/import/images.test.ts`: tests (below).
- `docs/guides/database-vps.md` §11: one paragraph on lowres keys and the upgrade.
- No change to `scripts/mirror-images.ts`, the Workflow step or the API read path. `imageUrl` already prefers any R2 key, and the CSP already allows the host.
- No migration and no grant change. The mirror role still only updates `image_key`.

**Tests (vitest, `images.test.ts`):**

- `sourceUrl`:
  - Takes `large` for a `lowres` print when allowed.
  - Null when it is not allowed (localization).
  - Null for `placeholder` / `missing`.
  - High-res unchanged.
- `planJobs`: a lowres print gets `orig-lowres.jpg` / `sm-lowres.webp` keys. A lowres `de` localization is `noSource`.
- `hasSm` on both names.
- Postgres block (`describe.skipIf(!databaseUrl)`):
  - A lowres print is picked by `pendingRows`, mirrored, and gets the `sm-lowres` key with `sm`.
  - The `sm` catch-up does not pick it again.
  - After `highres_image` is set to true it is pending again, gets `sm.webp`, and `writeKeys` replaces the lowres key.
  - A high-res key is never replaced by a lowres one.
  - A lowres localization is never pending.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test` (with the Postgres test URL if CI has it) and `pnpm build` from the root, then `pnpm format`.

**Run on dev (VPS, after the build PR is merged and `~/voidbinder` is pulled; docs/guides/database-vps.md §11):**

```sh
cd ~/voidbinder && git pull && pnpm install
ENV="--env-file $HOME/.config/voidbinder/r2.env --env-file $HOME/.config/voidbinder/pg.env"
pnpm --filter api mirror-images $ENV --db dev --game mtg --limit 50 --sm --dry-run   # sample keys end in -lowres
pnpm --filter api mirror-images $ENV --db dev --game mtg --limit 50 --sm
# check: 50 prints have an sm-lowres key, img.voidbinder.de/<key> answers 200, the card page shows it
pnpm --filter api mirror-images $ENV --db dev --game mtg --sm 2>&1 | tee ~/mirror-lowres-$(date +%F).log
```

Expect about 3,066 images at 20/s, roughly 3 minutes and 300 MB. Then verify read-only:

```sql
select count(*) from prints p join sets s on s.id = p.set_id
where s.game_id = 'mtg' and p.image_key is null
```

This should give 569 (the placeholders). Prod: the nightly timer (`image-mirror.timer`, both databases, `--sm --verify`) picks the rows up once the VPS checkout has the code. Pulling on the VPS therefore counts as Max's go for prod. A manual prod run is `--db prod --game mtg --sm --verify`, only after Max's go.

**Accepted:** after an upgrade, the lowres objects stay in R2 as orphans (a few hundred kB per print). They are not worth a cleanup job.

## What needs Max

1. **Email Scrydex** (VB-84) with these questions:
   - May Voidbinder, a paid collection app, download card images from `images.pokemontcg.io` / `images.scrydex.com` and host them itself, as their best-practices page recommends, given the "mirror" clause in their terms?
   - Would the Starter plan ($29/month) cover MEP, the trainer kits and the sets after 2027-03-01, when the free API ends?
2. **Magic placeholder prints** (VB-87): decided 2026-10-10, the sibling printing's scan; built with VB-86.
3. **Magic localized lowres** (VB-88): show the German lowres scan for German copies instead of the English high-res scan?
4. **Pokémon other-language scans** (VB-86): decided 2026-10-10, show what exists in the order EN > JA > the rest, for every game, a high-res scan before a lowres one; built (the API's image fallback chain, `apps/api/src/platform/cloudflare/image.ts`). The import of the `es`/`it`/`fr` scans is still open.
5. **Yugipedia legal check** (VB-93, VB-94): CC BY-SA 4.0 attribution and ShareAlike reach for names, texts and set codes; the Konami database terms.
6. **Upstream report** (VB-90): go for a public issue at tcgdex/cards-database, or file it yourself.
7. **The top fix's build PR**: once it is merged and the VPS checkout is pulled, the nightly mirror fills prod with the lowres scans. Pulling is the prod go.
