-- VB-109: 1 for a Yu-Gi-Oh! Extended Art print (Postgres `external_ids.artwork.alt = 'EA'`, VB-106),
-- else null. Null is right for every row written before it, so no full rewrite is needed: the
-- refresh hashes the flag only where it is set, so the sets with one are the ones rewritten.
ALTER TABLE prints ADD COLUMN extended_art INTEGER;
