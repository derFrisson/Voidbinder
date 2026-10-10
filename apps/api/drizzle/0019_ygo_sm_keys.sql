-- Hand-written (VB-117 follow-up, 2026-10-11): migration 0018 gave standard-artwork prints a
-- sibling's render key, and "ORDER BY image_key" preferred `orig.jpg` over `sm.webp`, so a grid
-- showed a full-size original next to 320 px copies. A print keyed to an `orig.*` file takes the
-- `sm.webp` key another print holds in the same folder (same passcode and language), so every
-- tile uses the same size; the VPS mirror's --sm run makes the rest. Idempotent.
UPDATE "prints" p SET "image_key" = regexp_replace(p."image_key", '/[^/]+$', '/sm.webp')
FROM "sets" s
WHERE s."id" = p."set_id" AND s."game_id" = 'yugioh'
  AND p."image_key" ~ '^images/yugioh/[0-9]+/[a-z]+/orig\.[a-z]+$'
  AND EXISTS (
    SELECT 1 FROM "prints" q
    WHERE q."image_key" = regexp_replace(p."image_key", '/[^/]+$', '/sm.webp')
  );
