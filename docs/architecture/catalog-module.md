# Offline catalog modules

The scanner and the app read the catalog offline from one SQLite file per game, the catalog
module (VB-29). It is built nightly on the database VPS by
`apps/api/scripts/build-catalog-module.ts` (runbook:
[database-vps.md, section 12](../guides/database-vps.md#12-offline-catalog-modules)) and served
from the public R2 bucket `voidbinder-catalog` on `img.voidbinder.de`. The app side (VB-33, VB-67)
is a thin reader of this contract.

## Files

| R2 key (`<env>`: `dev`, `prod`)                        | What                                         |
| ------------------------------------------------------ | -------------------------------------------- |
| `modules/<env>/<game>/manifest.json`                   | The latest version, its files and the deltas |
| `modules/<env>/<game>/catalog-<game>-v<n>.sqlite.gz`   | The module of catalog_version `n`, gzipped   |
| `modules/<env>/<game>/catalog-<game>-v<a>-v<b>.sql.gz` | SQL that turns module `a` into module `b`    |

`<n>` is the global `app_meta.catalog_version` the module was built from, so versions of one game
jump (every import of any game bumps it) and only grow. Modules and deltas never change once
written (`Cache-Control: public, max-age=31536000, immutable`); the manifest is replaced by every
build (`max-age=60`). Images are not inside: the module has image keys, the URL is
`https://img.voidbinder.de/<image_key>` as in the API.

Sizes (2026-10-10): Yu-Gi-Oh! on `dev` (44,266 prints, 48,801 prices) 68 MB unpacked, 20 MB
gzipped, built in 9 s; Magic from a local catalog with almost no prices (103,435 prints) 145 MB,
37 MB gzipped, most of it `cards` (legalities and attributes).

## Manifest

`ModuleManifestSchema` in `packages/shared/src/api/modules.ts`; `GET /catalog/modules` answers
`{ modules: [manifest, …] }` for every game that has one (cached like the catalog, ADR 0004).

```json
{
  "game": "yugioh",
  "version": 1042,
  "schemaVersion": 1,
  "minAppSchemaVersion": 1,
  "builtAt": "2026-10-11T06:30:04.120Z",
  "module": {
    "url": "https://img.voidbinder.de/modules/prod/yugioh/catalog-yugioh-v1042.sqlite.gz",
    "size": 18313256,
    "sha256": "…",
    "rawSize": 62373888,
    "rawSha256": "…"
  },
  "deltas": [
    {
      "from": 1030,
      "to": 1036,
      "url": "…/catalog-yugioh-v1030-v1036.sql.gz",
      "size": 412345,
      "sha256": "…"
    },
    {
      "from": 1036,
      "to": 1042,
      "url": "…/catalog-yugioh-v1036-v1042.sql.gz",
      "size": 398765,
      "sha256": "…"
    }
  ]
}
```

`size`/`sha256` are those of the bytes downloaded (gzip); `rawSize`/`rawSha256` those of the
unpacked SQLite file. `deltas` is one contiguous chain, oldest first, ending at `version`; it
holds the last 30 and is empty when the build had no previous module to diff against.

## Schema (version 1)

All ids are the Postgres UUIDs as text, dates ISO strings, JSON columns JSON text. No foreign
keys are declared.

| Table                 | Key                                   | Columns                                                                                                           |
| --------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `meta`                | `key`                                 | `value`; keys `game`, `version`, `built_at`, `schema_version`                                                     |
| `sets`                | `id`                                  | `code`, `name` (en), `name_de`, `released_on`, `card_count`, `kind`, `image_key`                                  |
| `cards`               | `id`                                  | `name` (en), `type_line`, `text`, `attributes` (JSON), `legalities` (JSON)                                        |
| `prints`              | `id`                                  | `card_id`, `set_id`, `number`, `variant`, `rarity`, `finishes` (JSON array), `artist`, `image_key`, `released_on` |
| `print_localizations` | `id` (local), unique `print_id, lang` | `name`, `text`, `image_key`; `en` and `de` only                                                                   |
| `prices`              | `print_id, finish, currency`          | `cents`, `source`, `observed_at`                                                                                  |
| `names_fts`           | FTS5 over `print_localizations.name`  | tokenizer `unicode61 remove_diacritics 2`                                                                         |

`prices` holds one display price per print, finish and currency: the source that currency prefers
(`SOURCE_PREFERENCE` in `packages/core/src/prices`: EUR → Cardmarket, USD → TCGplayer, then
TCGplayer via Scryfall), its market price in integer cents in that source's currency, never
converted, with the time the source observed it. Indexes: `prints (card_id)`,
`prints (set_id, number)`.

Name search (both languages, umlauts folded, `*` for a prefix):

```sql
SELECT p.*, l.lang, l.name
FROM names_fts JOIN print_localizations l ON l.id = names_fts.rowid
JOIN prints p ON p.id = l.print_id
WHERE names_fts MATCH ? ORDER BY rank LIMIT 50;
```

`print_localizations.id` is local to a file (a delta inserts rows with new ids): never store it,
key on `print_id, lang`. Triggers on `print_localizations` keep `names_fts` in step.

## Deltas

Plain SQL, one statement per line after a `-- catalog-<game> v<a> -> v<b>` comment: first
`DELETE FROM <table> WHERE <key> = …;` for every row the new module lacks, then
`INSERT INTO <table> (…) VALUES (…) ON CONFLICT (<key>) DO UPDATE SET …;` for every row that is
new or changed, `meta` included (so `meta.version` becomes `b`). The upserts fire the FTS
triggers; `INSERT OR REPLACE` would not. The file has no `BEGIN`/`COMMIT`: the app wraps it.
Applying the chain to module `a` gives the same rows as module `b` (tested in
`build-catalog-module.test.ts`).

## The app's side

1. **Check.** Fetch `GET /catalog/modules` (or a game's `manifest.json`). Skip a game whose
   `minAppSchemaVersion` is above the reader version the app was built for; keep the module it
   has. Nothing to do when the stored module's `meta.version` equals `version`.
2. **Choose.** With a stored module of version `v`: when `deltas` has an entry with `from == v`,
   download that entry and every later one; otherwise (no module, `v` older than the chain, a
   chain that does not start at `v`) download `module`.
3. **Verify.** SHA-256 of each downloaded file must equal its `sha256` (and its length `size`);
   otherwise delete it and retry later. Decompress (gzip); for a full module the result must
   match `rawSha256`. Free space: a full download needs `size + rawSize` while it unpacks.
4. **Store.** Write the full module to a temporary name in the app's own document directory
   (never the cache directory, which the OS may clear), then rename it over the old one, so a
   crash never leaves half a module.
5. **Apply deltas** in order on their own connection: for each, check `meta.version == from`,
   run the file in one transaction (`withExclusiveTransactionAsync` in expo-sqlite), then check
   `meta.version == to`. A failure rolls back and falls back to the full module. Close that
   connection.
6. **Read.** Open the module as its own database or `ATTACH DATABASE '<path>' AS catalog_<game>`
   to the app's database, and only read from it: it is replaced or patched only by steps 4 and 5,
   while it is detached. Check `meta.schema_version` before the first query.

expo-sqlite opens a database file from any directory (`openDatabaseAsync(name, options,
directory)`), ships FTS5 by default (config plugin `enableFTS`, default `true`) and names no size
limit; SQLite itself handles files far larger than these.
