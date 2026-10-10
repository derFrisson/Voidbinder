-- Hand-written (VB-117 follow-up, 2026-10-10): the Yugipedia gallery run before VB-117 keyed
-- thousands of standard-artwork prints to their scan. VB-117's rule shows the passcode render for
-- those, and the image mirror would re-store it over days (500 rows a day). One look everywhere
-- now: a standard-artwork print whose key names a scan takes the render key a print of the same
-- passcode still has (the object exists in R2), else its key is cleared so the mirror re-stores
-- the render on its next run (the app shows the card back meanwhile). Prints with an alt code or
-- own_art keep their scan. Idempotent.
UPDATE "prints" p SET "image_key" = (
  SELECT q."image_key" FROM "prints" q
  WHERE q."external_ids" ->> 'ygoprodeck' = p."external_ids" ->> 'ygoprodeck'
    AND q."image_key" LIKE 'images/yugioh/' || (p."external_ids" ->> 'ygoprodeck') || '/%'
  ORDER BY q."image_key" LIMIT 1
)
FROM "sets" s
WHERE s."id" = p."set_id" AND s."game_id" = 'yugioh' AND p."image_key" IS NOT NULL
  AND p."external_ids" ->> 'ygoprodeck' IS NOT NULL
  AND p."image_key" NOT LIKE 'images/yugioh/' || (p."external_ids" ->> 'ygoprodeck') || '/%'
  AND coalesce(p."external_ids" #>> '{artwork,alt}', '') = ''
  AND coalesce(p."external_ids" #>> '{artwork,own_art}', '') <> 'true'
  AND EXISTS (
    SELECT 1 FROM "prints" q
    WHERE q."external_ids" ->> 'ygoprodeck' = p."external_ids" ->> 'ygoprodeck'
      AND q."image_key" LIKE 'images/yugioh/' || (p."external_ids" ->> 'ygoprodeck') || '/%'
  );--> statement-breakpoint
UPDATE "prints" p SET "image_key" = NULL
FROM "sets" s
WHERE s."id" = p."set_id" AND s."game_id" = 'yugioh' AND p."image_key" IS NOT NULL
  AND p."external_ids" ->> 'ygoprodeck' IS NOT NULL
  AND p."image_key" NOT LIKE 'images/yugioh/' || (p."external_ids" ->> 'ygoprodeck') || '/%'
  AND coalesce(p."external_ids" #>> '{artwork,alt}', '') = ''
  AND coalesce(p."external_ids" #>> '{artwork,own_art}', '') <> 'true';
