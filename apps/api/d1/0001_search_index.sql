-- The search index (VB-98, ADR 0006): a read-only copy of what the typeahead reads, refreshed
-- from Postgres by the SearchIndexRefresh Workflow (src/import/search-index.ts). Postgres stays
-- the source of truth; nothing else writes here.
-- One statement per line: the tests apply this file statement by statement.

-- `hash` covers the set and every print and name of it; the refresh rewrites a set whose hash changed.
CREATE TABLE sets (id TEXT PRIMARY KEY, game TEXT NOT NULL, code TEXT NOT NULL, code_key TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, released_on TEXT, card_count INTEGER, hash TEXT NOT NULL);
CREATE INDEX sets_code_key ON sets (code_key);
CREATE TABLE set_names (set_id TEXT NOT NULL, lang TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, PRIMARY KEY (set_id, lang)) WITHOUT ROWID;

-- number_alnum, number_key and number_value are Postgres' own expressions (catalog_number_key …).
CREATE TABLE prints (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, set_id TEXT NOT NULL, card_name TEXT NOT NULL, number TEXT NOT NULL, number_value INTEGER, number_alnum TEXT NOT NULL, number_key TEXT, variant TEXT NOT NULL, rarity TEXT, image_key TEXT, image_src TEXT);
CREATE INDEX prints_set_id ON prints (set_id);
CREATE INDEX prints_card_id ON prints (card_id);
CREATE INDEX prints_number_key ON prints (number_key);

-- A print's localized names; lang '' is the English card name where no `en` name equals it.
-- name_key is the name in lower case (prefix matches by range on names_name_key); grams is each
-- word of it padded as pg_trgm pads it ('  word '), so names_trigrams has pg_trgm's trigrams.
CREATE TABLE names (id INTEGER PRIMARY KEY, print_id TEXT NOT NULL, lang TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, grams TEXT NOT NULL, image_key TEXT, image_src TEXT);
CREATE INDEX names_print_id ON names (print_id, lang);
CREATE INDEX names_name_key ON names (name_key);

-- The trigrams of grams: the candidates of the similar names (pg_trgm's `%`).
CREATE VIRTUAL TABLE names_trigrams USING fts5 (grams, content = 'names', content_rowid = 'id', tokenize = 'trigram');
CREATE TRIGGER names_ai AFTER INSERT ON names BEGIN INSERT INTO names_trigrams (rowid, grams) VALUES (new.id, new.grams); END;
CREATE TRIGGER names_ad AFTER DELETE ON names BEGIN INSERT INTO names_trigrams (names_trigrams, rowid, grams) VALUES ('delete', old.id, old.grams); END;

-- catalog_version and synced_at of the last refresh; `lock` while one runs.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
