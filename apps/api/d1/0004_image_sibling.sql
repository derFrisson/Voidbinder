-- VB-117: 1 where the image key is another rarity's scan of the same artwork (Postgres
-- `external_ids.artwork.sibling`, the gallery import's stand-in for a missing scan), else null.
-- Null is right for every row written before it; the refresh hashes the flag only where it is set.
-- One statement per line: the tests apply this file statement by statement.
ALTER TABLE prints ADD COLUMN image_sibling INTEGER;
ALTER TABLE names ADD COLUMN image_sibling INTEGER;
