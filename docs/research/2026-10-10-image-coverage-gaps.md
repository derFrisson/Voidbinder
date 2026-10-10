# Card image coverage gaps (2026-10-10)

Gap report for ticket DQ (data quality: card images). Measured on the dev catalog (same catalog as prod, last TCGdex delta 2026-10-10 05:30 UTC, last Scryfall full 03:44 UTC), read-only through `ssh voidbinder-db`; source probes ran against the live TCGdex, Scryfall and TCGplayer endpoints the same day. Nothing was written to any database or bucket.

## Summary

| game    |  prints | without `image_key` | share | main cause                                                                                                                                             |
| ------- | ------: | ------------------: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| mtg     | 103,435 |               3,635 | 3.5 % | Scryfall flags the image `lowres` (3,066) or `placeholder` (569); our mirror skips both on purpose                                                     |
| pokemon |  21,290 |               1,627 | 7.6 % | TCGdex declares no image for 1,106; 457 have the image in another language; 61 have a file TCGdex does not declare; 3 declare a file that is not there |
| yugioh  |  44,266 |                   0 |   0 % | none for images; localized names (2,508 cards without `de`) and set codes (no non-EN codes at all) are the gap, see the Yu-Gi-Oh! section              |

Causes, per the four classes in the brief plus the ones the probes turned up. A print is counted once, first match in the order E, D, C, A for Pokemon.

| class                                          | meaning                                                          |                                mtg |                                                                                                pokemon |
| ---------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------: | -----------------------------------------------------------------------------------------------------: |
| (a) source has no image                        | the source API declares no image and no file exists              |                                  0 |                                                                                              1,106 (A) |
| (b) source has an image, our import ignores it | importer or mirror policy skips a usable file                    |              3,066 lowres (policy) |                                   61 (E: file exists at the conventional path, `card.image` is absent) |
| (c) mirror failure                             | image declared, download failed                                  |                                  0 |                          3 (30th B, G, R: declared, 404 today); 3 more have it in another language (D) |
| (d) another language has the image             | `print_localizations` or the source holds it in another language | 4 (plus 3,086 siblings, see below) | 457 (85 already stored as `de` localization key, 372 only in `es`, `it`, `fr`, which we do not import) |
| (e) placeholder art                            | Scryfall serves a "Localized Image Not Available" card           |                                569 |                                                                                                      0 |

The importer is not losing cards: for all 205 physical Pokemon sets the number of prints equals the number of cards TCGdex lists (checked against `/v2/en/sets/<id>` for each), and odd numbers (`B`, `G`, `R`, `54a`, `SV001`, `E`, `!`) are stored as the source `localId`. The 15 TCG Pocket sets (`A1` to `B2a`, `P-A`) are skipped by design.

## Magic: The Gathering

Source data is `prints.external_ids.scryfall_images` (copied from the Scryfall bulk file). The mirror takes a print only when `highres_image` is true (`sourceUrl` in `apps/api/src/import/images.ts`, same condition in `needsWork`); the comment there says a lowres image stays keyless so the API keeps Scryfall's URL "until a later run finds the scan".

| `image_status` | prints without key | prints in total | what Scryfall says ([card imagery docs](https://scryfall.com/docs/api/images))                                                           |
| -------------- | -----------------: | --------------: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `highres_scan` |                  0 |          99,794 | full-resolution scanner image                                                                                                            |
| `lowres`       |              3,066 |           3,066 | "low-quality, either because it was just spoiled or we do not have better photography for it yet"                                        |
| `placeholder`  |                569 |             575 | "Scryfall does not have an image of this card, but we know it exists and we have uploaded a placeholder; most common on localized cards" |
| `missing`      |                  0 |               0 | no image                                                                                                                                 |

Six `placeholder` prints already carry a key (a previous run mirrored them); no `lowres` print has one.

Evidence:

- Source probe: 132 prints (up to 3 random keyless prints from each of 44 sets) fetched from `https://api.scryfall.com/cards/<id>` on 2026-10-10: 121 still `lowres`, 11 still `placeholder`, all `highres_image: false`, none `missing`. Nothing changed since the import, so these are not stale rows.
- Lowres files are real, usable scans: `Neriv, Heart of the Storm` (TDM 366) and `Cyclopean Tomb` (30A 533) were downloaded at `large` (672x936 JPEG, 100 to 120 kB) and `png` (745x1040). The 30A one is visibly soft, the TDM one is crisp. Both return 200 on `cards.scryfall.io`.
- Placeholder files are the English front of the card with a banner "Localized Image Not Available" and a language badge (viewed: `Wall of Fire`, 4BB, ES). Mirroring them would show that banner in the app. They exist because the print is non-English only (see below).
- Mirror failures: 0. The 2026-10-09 run mirrored 103,891 images for 202,638 rows, `failed: 0` ([`~/mirror-2026-10-09.log`](#evidence-sources)). `import_runs` for `images` / `mtg` shows `failed: 0`.
- Placeholder prints are the non-English-only prints: 377 are `es`, 116 `de`+`fr`, 72 `ja`, 3 `zht`, 1 `de`. By set: `4bb` Fourth Edition Foreign Black Border 376, `fbb` 116, `bchr` 72, `8ed` 3, `4ed` 1, `mir` 1.
- Lowres by set (keyless / prints): `30a` 594/594, `ltr` 465/854, `ltc` 432/591, `tdc` 411/413, `tdm` 403/426, `fbb` 299/307 (183 lowres plus the placeholders), `unk` 203/527, `rvr` 64/531, `moc` 57/450, `sld` 56/2768. By year: 2022 609, 2023 1,193, 2025 837, 1994/95 806 (foreign black border), rest scattered.
- Sibling images: for every keyless print the same card has another print with a key in the catalog except 549 lowres prints. 2,517 of the 3,066 lowres prints and all 569 placeholder prints have a sibling print with a `highres_scan` key (3,086 total), so a "same card, other print" fallback closes 85 % of the gap with no new source.
- Another language of the same print: 4 prints have a localization with a key (class d).
- TCGplayer ids: 3,415 of 3,635 keyless prints carry `external_ids.tcgplayer`, 2,555 have a `price_mappings` row for `tcgplayer`.

Localizations (not prints): 57,412 of 162,450 `print_localizations` rows have no key. `de` 53,779 of 59,024 (lowres 42,480, placeholder 11,293), `en` 2,807 (all `lowres`), `es` 377, `fr` 299, `ja` 133. The English `lowres` ones are the same 2,807 prints counted above.

Related, not a gap: 64 Scryfall sets have no prints because the importer skips `art_series`, `token`, `double_faced_token` and `emblem` layouts and digital-only cards (`skipReason` in `scryfall/map.ts`); 41 of them are Art Series (`memorabilia`), 15 `minigame`. That is why 117 MTG sets have fewer prints than Scryfall's `card_count` (3,077 cards in total, the biggest `amh2` and `astx` with 162 each). `nau` (Nauctis: The Sunken Realm) has `card_count` 0 and no prints.

## Pokemon

Source data is `prints.external_ids.tcgdex_images.high`, written from TCGdex's `card.image` (`imageIds` in `apps/api/src/import/tcgdex/map.ts`), and the file is `<image>/high.webp`. TCGdex only returns `image` when it has a picture, so a print without `tcgdex_images` has none declared.

Of 1,627 keyless prints, 1,621 have no `tcgdex_images` and 6 have one. Method for each class:

- **A, no source image (1,106 prints).** `GET /v2/en/cards/<id>` has no `image` field, no Western language TCGdex serves (`de`, `fr`, `es`, `es-mx`, `it`, `pt-br`, `pt-pt`, `nl`, `pl`, `ru`) declares one for the set's card (set lists fetched for all 69 affected sets in 11 languages, assets HEAD-checked), and the file is absent at the conventional path `https://assets.tcgdex.net/en/<serie>/<set>/<localId>/high.webp` (HEAD for all 1,627 prints). 139 of a 143-card sample (20 per set class, random) confirmed this card by card with 10 more languages (`ja`, `ko`, `zh-tw`, `id`, `th` answer 404: those catalogs use different set ids, see the Mew section).
- **E, file exists but TCGdex does not declare it (61 prints).** Same HEAD probe: the file answers 200 although the card JSON has no `image` (for example `mep-013`, `sm3.5-67`, `svp-218`, whose `GET /v2/en/cards/<id>` has no `image`). 43 `mep` prints (001 to 031, 037 to 045), 17 `svp` prints (191 to 205, 213 to 218, 224, 225, 500; 200 of 226 `svp`, ids in the list below) and `sm3.5-67`, `sm3.5-70`. The importer only trusts `card.image`, so it never queues them. This is a missing guess, not a bug in the mapping.
- **D, another language has the image (457 prints).** The en card has no declared image but another language does and the file answers 200: `es` 422 prints, `it` 296, `fr` 44, `de` 85 (the `de` ones are already stored: `print_localizations.image_key` is set for 85 keyless prints, 87 before the E overlap). 372 of the 457 exist only in `es`, `it` or `fr`, languages the importer does not fetch (`languages: ["en","de"]` in the last run stats). Biggest groups: `sm3.5` Shining Legends 76 (de, es, it), the 15 XY and BW trainer kits (210 of the 30-card kits, es and mostly it), Aquapolis 26 (fr), Forbidden Light 6, and singles (`dc1-1`, `ex14-97`, `sv03.5-163`, `sm2-143`, `xy8-146a`, `pl2`, `bwp` 3, `xyp` 3).
- **C, declared but the file is missing (3 prints, plus 3 that D already covers).** The URL is in `external_ids` but `high.webp` answers 404: `30th-B`, `30th-G`, `30th-R` (Mew), `dc1-1` (Team Magma's Numel), `ex14-97` (Shiftry ex), `sv03.5-163` (Leftovers). The mirror log shows exactly these as `image failed ... answered 404` (14 URLs: the six `en` ones above, the `de` pair for each Mew, and `de` for `bw2-9`, `sm1-94`, `swsh10-162`, `swsh12-047`, `sv02-269`). They were still 404 when re-checked (HEAD) today. Every delta run retries these 14 (the daily `images` run record shows `failed: 14`).

Per set (keyless prints, all sets with a gap; sorted by size). A = no source image, E = file exists but undeclared, D = other language has it, C = declared but 404. Languages count prints.

| Set           | no image / prints | A: no source image | E: file exists, not declared | D: other language has it | C: declared, file 404 | languages (prints)     |
| ------------- | ----------------- | ------------------ | ---------------------------- | ------------------------ | --------------------- | ---------------------- |
| `swsh4.5sv`   | 122 / 122         | 122                |                              |                          |                       |                        |
| `mep`         | 112 / 112         | 72                 | 40                           |                          |                       |                        |
| `sm3.5`       | 78 / 78           |                    | 2                            | 76                       |                       | de 78, es 78, it 78    |
| `sm7.5`       | 78 / 78           | 78                 |                              |                          |                       |                        |
| `swsh12.5gg`  | 70 / 70           | 70                 |                              |                          |                       |                        |
| `smp`         | 67 / 248          | 67                 |                              |                          |                       |                        |
| `ecard2`      | 40 / 186          | 14                 |                              | 26                       |                       | fr 26                  |
| `mfb`         | 34 / 34           | 34                 |                              |                          |                       |                        |
| `svp`         | 34 / 226          | 15                 | 19                           |                          |                       |                        |
| `ecard3`      | 32 / 182          | 32                 |                              |                          |                       |                        |
| `30th-c`      | 30 / 30           | 30                 |                              |                          |                       |                        |
| `swsh10tg`    | 30 / 30           | 30                 |                              |                          |                       |                        |
| `swsh11tg`    | 30 / 30           | 30                 |                              |                          |                       |                        |
| `swsh12tg`    | 30 / 30           | 30                 |                              |                          |                       |                        |
| `swsh9tg`     | 30 / 30           | 30                 |                              |                          |                       |                        |
| `tk-bw-e`     | 30 / 30           |                    |                              | 30                       |                       | es 30                  |
| `tk-bw-z`     | 30 / 30           |                    |                              | 30                       |                       | es 30                  |
| `tk-hs-g`     | 30 / 30           | 30                 |                              |                          |                       |                        |
| `tk-hs-r`     | 30 / 30           | 30                 |                              |                          |                       |                        |
| `tk-sm-r`     | 30 / 30           | 11                 |                              | 19                       |                       | es 19, it 19           |
| `tk-xy-b`     | 30 / 30           |                    |                              | 30                       |                       | es 30, it 30           |
| `tk-xy-latia` | 30 / 30           |                    |                              | 30                       |                       | es 30, it 22           |
| `tk-xy-latio` | 30 / 30           |                    |                              | 30                       |                       | es 30, it 19           |
| `tk-xy-n`     | 30 / 30           |                    |                              | 30                       |                       | es 30, it 24           |
| `tk-xy-p`     | 30 / 30           |                    |                              | 30                       |                       | es 30, it 21           |
| `tk-xy-su`    | 30 / 30           |                    |                              | 30                       |                       | es 30, it 7            |
| `tk-xy-sy`    | 30 / 30           |                    |                              | 30                       |                       | es 30, it 30           |
| `tk-xy-w`     | 30 / 30           |                    |                              | 30                       |                       | es 30, it 21           |
| `exu`         | 28 / 28           | 28                 |                              |                          |                       |                        |
| `2021swsh`    | 25 / 25           | 25                 |                              |                          |                       |                        |
| `cel25cc`     | 25 / 25           | 25                 |                              |                          |                       |                        |
| `sve`         | 24 / 24           | 24                 |                              |                          |                       |                        |
| `swshp`       | 22 / 307          | 22                 |                              |                          |                       |                        |
| `tk-sm-l`     | 18 / 18           |                    |                              | 18                       |                       | es 18, it 18           |
| `mee`         | 16 / 16           | 16                 |                              |                          |                       |                        |
| `2022swsh`    | 15 / 15           | 15                 |                              |                          |                       |                        |
| `2023sv`      | 15 / 15           | 15                 |                              |                          |                       |                        |
| `2024sv`      | 15 / 15           | 15                 |                              |                          |                       |                        |
| `2011bw`      | 12 / 12           | 12                 |                              |                          |                       |                        |
| `2012bw`      | 12 / 12           | 12                 |                              |                          |                       |                        |
| `2014xy`      | 12 / 12           | 12                 |                              |                          |                       |                        |
| `2015xy`      | 12 / 12           | 12                 |                              |                          |                       |                        |
| `2016xy`      | 12 / 12           | 12                 |                              |                          |                       |                        |
| `2017sm`      | 12 / 12           | 12                 |                              |                          |                       |                        |
| `2018sm`      | 12 / 12           | 12                 |                              |                          |                       |                        |
| `2019sm`      | 12 / 12           | 12                 |                              |                          |                       |                        |
| `tk-dp-m`     | 12 / 12           | 12                 |                              |                          |                       |                        |
| `tk-ex-m`     | 12 / 12           | 12                 |                              |                          |                       |                        |
| `tk-ex-p`     | 12 / 12           | 12                 |                              |                          |                       |                        |
| `tk-dp-l`     | 11 / 11           | 11                 |                              |                          |                       |                        |
| `tk-ex-latia` | 10 / 10           | 10                 |                              |                          |                       |                        |
| `tk-ex-latio` | 10 / 10           | 10                 |                              |                          |                       |                        |
| `bog`         | 9 / 9             | 9                  |                              |                          |                       |                        |
| `hgssp`       | 9 / 25            | 9                  |                              |                          |                       |                        |
| `sm6`         | 6 / 146           |                    |                              | 6                        |                       | de 6, fr 6, es 6, it 6 |
| `xya`         | 6 / 6             | 6                  |                              |                          |                       |                        |
| `ex5.5`       | 5 / 5             | 5                  |                              |                          |                       |                        |
| `30th`        | 3 / 161           |                    |                              |                          | 3                     |                        |
| `bwp`         | 3 / 101           |                    |                              | 3                        |                       | fr 3                   |
| `xyp`         | 3 / 216           |                    |                              | 3                        |                       | fr 3                   |
| `pop6`        | 2 / 17            | 2                  |                              |                          |                       |                        |
| `cel25`       | 1 / 25            | 1                  |                              |                          |                       |                        |
| `dc1`         | 1 / 34            |                    |                              | 1                        |                       | fr 1                   |
| `ex14`        | 1 / 100           |                    |                              | 1                        |                       | fr 1                   |
| `miscp`       | 1 / 1             | 1                  |                              |                          |                       |                        |
| `pl2`         | 1 / 120           |                    |                              | 1                        |                       | fr 1                   |
| `sm2`         | 1 / 169           |                    |                              | 1                        |                       | de 1, fr 1, es 1, it 1 |
| `sv03.5`      | 1 / 207           |                    |                              | 1                        |                       | de 1, fr 1, es 1, it 1 |
| `xy8`         | 1 / 165           |                    |                              | 1                        |                       | de 1, fr 1, es 1, it 1 |

Sets with the whole set keyless are the ones where TCGdex has no pictures at all: `swsh4.5sv` Shining Fates Shiny Vault 122, `sm7.5` Dragon Majesty 78, `swsh12.5gg` Crown Zenith Galarian Gallery 70, `mep` (72 of 112), all Trainer Galleries (`swsh9tg` to `swsh12tg`, 30 each), the McDonald's collections (`2011bw` to `2024sv`), `cel25cc`, `sve`, `mee`, `exu`, `bog`, `ex5.5`, `xya`, and the XY/BW/HS/DP/EX trainer kits that no other language covers. The brief's list of 30-card sets is correct for every set in it.

Pokemon localizations: `de` has 19,006 rows, 5,238 without key (5,230 without a declared image, 8 declared but 404); `en` 21,290 rows, 1,627 without key. Only `en` and `de` are imported.

Not a gap but a bug in the data: the set card counts. TCGdex's `cardCount.official` is 0 for `mep` (`card_count` 0 in our `sets`, 112 prints) and was 0 for `30th-c` at the last import (TCGdex says 30 now, `card_count` 0 and 30 prints stored). `mee` and `30th`/`mep` store a total (8, 158, 89) that TCGdex has since raised (16, 161, 112), so 3 sets have more prints than their stored total; the other 105 sets with more prints than `card_count` (2,127 extra prints) are exactly the secret rares and gallery cards TCGdex counts in `cardCount.total` but not in `official` (print count equals `total` in all of them). Six sets have fewer prints than `card_count` (228 cards): `jumbo`, `rc`, `sp`, `wp` list no cards at all in TCGdex (set exists, 0 cards), `mfb` lists 34 of 48 and `tk-sm-l` 18 of 30; those are source gaps, TCGdex's `/sets` brief has `cards: []`, not importer losses. The next import corrects the stale ones (checked: set rows are refreshed when the source hash changes).

### The Mew B/G/R case

What TCGdex returns today (2026-10-10):

- `GET /v2/en/cards/30th-B` (and `-G`, `-R`): 200, `name: "Mew"`, `localId: "B"`, `rarity: "RGB Rare"`, `illustrator: "YOSHIROTTEN"`, `hp: 60`, `dexId: [151]`, `image: "https://assets.tcgdex.net/en/me/30th/B"`, variant `holo`, third party ids `cardmarket 909511` and `tcgplayer 717609` for B (G: 909510 and 717608, R: 909509 and 717607).
- `GET /v2/de/cards/30th-B`: 200, same card with `image: https://assets.tcgdex.net/de/me/30th/B`.
- The files do not exist: `…/en/me/30th/B/high.webp`, `…/low.webp`, `…/high.png`, `…/de/me/30th/B/high.webp` and the `fr`, `es`, `es-mx`, `it` ones all answer 404. Their siblings (`30th/001/high.webp`) answer 200. So TCGdex lists the card and an image URL but never uploaded the three files; the image field is the only thing that exists.
- Japan: the set is `M6a` in `ja` (176 cards, includes `M6a-B`, `M6a-G`, `M6a-R`, all named ミュウ, RGB Rare) and has no image for any of its 176 cards.
- The importer is correct for these: `number` is `B`, the print exists in `30th` (161 prints: 128 official plus 33 extra), `external_ids.tcgdex = "30th-B"` and `tcgdex_images.high` is stored. The mirror tried and failed with 404 (`mirror-2026-10-09.log`, 03:41:48 to 03:41:55 for `en` and `de`). So the Mew prints are class C, not an import bug.
- `30th-c` (30th Classic Collection, 30 prints, source id range `30th-c-001` to `-030`): TCGdex lists the cards in the set but declares no `image` for any of them, so all 30 are class A.

Alternatives that serve the exact card, checked by HEAD or API on 2026-10-10 and not stored (their terms are for the fallback strategy, not decided here):

- TCGplayer CDN `https://tcgplayer-cdn.tcgplayer.com/product/717609_in_1000x1000.jpg` answers 200, a 660x920 JPEG of the correct card (viewed: Mew B/RGB, blue and green dither art, `B/RGB`). Of 60 random keyless Pokemon prints, 57 return 200 for their TCGplayer id (35 from `price_mappings`, 22 from TCGdex's marketplace ids; 3 answer 403: `tk-xy-b` 19, `mfb` 34, `tk-xy-latio` 15). Product ids from TCGdex are marked `mapping_confidence: low`; the image content of the 57 was not compared card by card. 1,557 of the 1,627 keyless prints carry a TCGplayer id.
- pokemontcg.io v2 (served by Scrydex now): set `me55` "30th Celebration" lists `me55-B`, `me55-G`, `me55-R` with `images.small` and `images.large` on `images.scrydex.com`; it also has `sm35` Shining Legends (81 cards), the `mcd11` to `mcd22` McDonald's sets and the EX trainer kits `tk1a`/`tk1b`/`tk2a`/`tk2b`. `images.pokemontcg.io/sm35/1_hires.png` and `.../swsh45sv/SV001_hires.png` answer 200.

## Yu-Gi-Oh!

0 of 44,266 prints are keyless. All 14,103 distinct images are mirrored (`mirror-prod-2026-10-10.log`, 14,103 images, 0 failed, 14,103 reused on the verify pass). Set size: 247 sets have more prints than `card_count` because a print is one rarity of a card number (`variant` is never empty for them; the 247 all have `variant` set, for example `sgx3` 245 prints for 220 numbers, `crbr` 105 for 60): not duplicates. 16 sets have `card_count` NULL (YGOPRODeck gives no count: `stas` 44 prints, `db` 14, `gtp2` 4, the Dark Beginning promo sets). `print_localizations.image_key` is NULL for all 83,479 localization rows by design (the mirror writes the print row, one image per card art); the app must read the print's key for them.

### Yu-Gi-Oh! localized printings (addendum)

Not an image gap, but the biggest catalog gap for Yu-Gi-Oh!. Decision by Max (2026-10-10 09:50 UTC): no separate print rows per language. The EN print stays the one print; DE/FR/IT/ES/PT (JP later) are `print_localizations` rows carrying the localized name, text and the localized set code (`external_ids.set_code`, e.g. `BLGG-DE024`), the image is shared with EN, and the collection entry's `lang` says which copy the user owns. The example card "Lev Shaddoll Fusion" (passcode 34950192) has only `BLGG-EN024` in our data.

Measured today (dev read-only, YGOPRODeck and Yugipedia live):

- Localization rows exist only for `en` (44,266, one per print) and `de` (39,213). No `fr`, `it`, `es`, `pt`, `ja` rows; no localized set code anywhere (`external_ids` of an EN print holds `set_code` = the EN code only).
- German names (class a): 11,598 of 14,106 cards have one, 2,508 do not (5,053 prints without a `de` row = 44,266 - 39,213). The importer does not skip them: `cardinfo.php?language=de` returns 11,769 cards today against 14,599 for English, and `?id=34950192&language=de` answers "No card matching your query". The gap is in the source. Yugipedia has `de_name` and `de_text` for all 25 of 25 sampled cards that our database has no German name for (sample below).
- Localized set codes (class b): Yugipedia's card page (`api.php?action=parse&page=<name>&prop=wikitext`, one request per card) carries `en_sets`, `de_sets`, `fr_sets`, `it_sets`, `pt_sets`, `sp_sets` (plus `jp`, `kr`, `sc`), each line `CODE; set name; rarities`. For Lev Shaddoll Fusion: `BLGG-EN024`, `-FR024`, `-DE024`, `-IT024`, `-PT024`, `-SP024` with the same rarities.
- Rule check, `-EN` swapped for `-DE`/`-FR`/`-IT`/`-PT`/`-SP` (Spanish uses `SP`, not `ES`) on a random sample of 120 cards (117 matched by passcode, 3 title lookups did not; 340 predicted codes per language from our EN prints, 1 request per second, `Voidbinder-research` user agent):

| language  | predicted codes | confirmed by Yugipedia | share |
| --------- | --------------: | ---------------------: | ----: |
| DE        |             340 |                    286 |  84 % |
| FR        |             340 |                    281 |  83 % |
| IT        |             340 |                    281 |  83 % |
| ES (`SP`) |             340 |                    279 |  82 % |
| PT        |             340 |                    212 |  62 % |

The misses are real exceptions, so the rule alone is not enough: (1) early sets whose EN code has no region token (`AST-081`, `LON-065`, `MRD-018`, `PGD-053`, `BPT-006`); the localized code does (`LON-DE065`, `LON-SP065`), so the token is inserted, not swapped; (2) printings that never existed in that language (Portuguese most, for example `PHSW-PT014`, `GLAS-PT023`, `REDU-PT024`: PT stops being printed for many sets); (3) our EN code differs from Yugipedia's list (54 of the sampled EN codes are not in Yugipedia's `en_sets`, for example `DR04-EN158`, `DT04-EN038`, `LON-E006`, `YS15-ENF27`: structure decks and old first-edition codes with letters); (4) the other direction: 16 to 23 codes per language exist in Yugipedia but are not predicted by any of our EN prints (`DB1-FR153`, `DB1-IT210`: sets released only in some languages). Per EN print this means about 4 localized codes on average, not 5.

- Row growth under Max's model: no new `prints`. `print_localizations` goes from 83,479 to about 44,266 x 4 = roughly 175,000 additional rows if every language is filled (about 40,000 per language, PT about 27,000), about 258,000 in total (3 times today). Under the earlier idea of one print per language code it would have been the same count in `prints`, which is why the localization model is cheaper for `search` and `collection` queries. The scanner and search resolve `BLGG-DE024` to the EN print by the code's key (VB-79 generates keys by rule; for the exceptions above they need the real list).

Sources and terms:

| source                                                                                       | gives                                                                                                     | terms (checked 2026-10-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| YGOPRODeck `cardinfo.php?language=<l>`                                                       | names and text for de, fr, it, pt only for the translated cards (de: 11,769 of 14,599), EN set codes only | already used; images never hotlinked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Yugipedia (MediaWiki 1.31 API, `robots.txt` crawl delay 1 s for msnbot, no stated API quota) | per-language name and text, per-language set codes and rarities, 9 languages                              | text CC BY-SA 4.0 (`Yugipedia:Licensing`, API `rightsinfo`): attribution plus ShareAlike for the copied text; our rows would need an attribution line and a decision on whether ShareAlike reaches the whole database (legal check before use). The card scans on the wiki are Konami's artwork (file pages are bare image summaries), CC BY-SA covers the wiki's own text, not those images, so images are not usable from there. About 14,100 requests at 1 per second is under 4 hours; a card page is also reachable by `redirects=1` and the title list |
| Konami card database (`db.yugioh-card.com`)                                                  | official names and text in all languages                                                                  | reachable (200), no API, scraping terms not checked in this run; treat as not usable until read                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Cardmarket, TCGplayer                                                                        | not usable for this (prices only, no printing data under a license we can mirror)                         | per brief                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Plan for Yu-Gi-Oh! (decision table at the end): fill the 2,508 missing German names, texts and the FR/IT/ES/PT names from Yugipedia after the legal check; build the localized set code per print and language from the swapped rule, then confirm or replace it with Yugipedia's `*_sets` lists (the lists are the truth, the rule only seeds the search key); keep the model as is.

## Other findings

- Prints without any localization: 0 in every game. Prints without a name in any language: 0. Prints without an `en` localization: 2,600 (MTG only, non-English-only prints such as `psal` 720, `4bb` 378, `fbb` 307, `ps11` 224, `soa` 130, `bchr` 125, `ren` 122); the 4bb/fbb/bchr ones are the placeholder prints above.
- Sets with `card_count` 0: `nau` (MTG, no prints), `mep`, `30th-c` (Pokemon, prints exist). 16 Yu-Gi-Oh! sets have NULL (listed above). Sets with no prints at all: Pokemon 4 (`jumbo`, `rc`, `sp`, `wp`, TCGdex lists zero cards), MTG 64, Yu-Gi-Oh! 2.
- The daily `images` step in every import Workflow retries the 14 TCGdex 404s (see C). Harmless, but it makes `failed: 14` the permanent value of the run record, which would hide a real failure. A 404 should be remembered, for example by a marker in `external_ids`.
- 2026-10-10 04:30 UTC the Scryfall `full` run failed with `GET https://api.scryfall.com/bulk-data answered 429`; the next run (03:44) was the last good one. Not an image problem; check that the daily cron backs off.

## What closes how much

| change                                                                                                                                      |                          prints | needs                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------: | ---------------------------------------------------------------------------------- |
| TCGdex convention URL (`assets.tcgdex.net/<lang>/<serie>/<set>/<localId>/high.webp`, HEAD to confirm) when `card.image` is absent           |                              61 | importer (`imageIds` has no fallback)                                              |
| Mirror MTG `lowres` scans (flagged in a field, replaced when Scryfall upgrades them)                                                        |                           3,066 | one condition in `sourceUrl` / `needsWork`; terms already cover Scryfall mirroring |
| MTG placeholder prints take the sibling print's image                                                                                       |                             569 | read path or a mirror step; none is stored as their own image                      |
| Import `es`, `it`, `fr` localizations for Pokemon and take any language as the print image when `en` has none                               |                             372 | importer languages; mirror; API fallback                                           |
| Use the `de` key already stored when `en` has none                                                                                          |                              85 | API read only, no download                                                         |
| TCGplayer CDN or pokemontcg.io for the rest (Mew B/G/R, Trainer Galleries, McDonald's, Shiny Vault, Dragon Majesty, `mep`, promos)          |                     about 1,100 | licensing check first (brief section 2)                                            |
| Fix `card_count` fallback: when `official` is 0, show `cardCountTotal`                                                                      |                          2 sets | display                                                                            |
| Yu-Gi-Oh! missing German names and texts (2,508 cards, about 5,050 prints)                                                                  |                  0 image prints | Yugipedia (CC BY-SA, legal check), 1 request per card                              |
| Yu-Gi-Oh! localized set codes on `print_localizations` (DE/FR/IT/ES/PT), seeded by rule (84 to 62 % exact), confirmed by Yugipedia `*_sets` | about 175,000 localization rows | Yugipedia crawl, key generation by rule (VB-79)                                    |

## Evidence sources

- Dev database, read-only (`select` only), 2026-10-10: tables `prints`, `print_localizations`, `sets`, `price_mappings`, `import_runs`.
- `~/mirror-2026-10-09.log` (VPS), `~/mirror-prod-2026-10-10.log`: the 14 `image failed` lines, finished lines of each run.
- Live probes: TCGdex `/v2/<lang>/cards/<id>`, `/v2/<lang>/sets/<id>`, `assets.tcgdex.net` HEAD (about 6,000 requests, under 10 per second, User-Agent `Voidbinder-research`); Scryfall `/cards/<id>` (132 requests, 100 ms apart); TCGplayer CDN HEAD (60 and the Mew ones); pokemontcg.io `/v2/sets`, `/v2/cards` (a handful).
- Code: `apps/api/src/import/images.ts`, `import/tcgdex/map.ts`, `import/tcgdex/pipeline.ts`, `import/scryfall/map.ts`, `scripts/mirror-images.ts`.
