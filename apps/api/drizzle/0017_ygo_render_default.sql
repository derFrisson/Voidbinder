-- Hand-written (VB-117): a Yu-Gi-Oh! print shows the passcode render unless its Yugipedia scan
-- (`external_ids.artwork`, VB-106) is an artwork other than the standard one: a gallery row with an
-- alt code, or a rarity printed with an artwork of its own (Grand Master Rare, `own_art`). The
-- prints whose key names a scan of the standard artwork go back to the render through the image
-- mirror (`needsWork`: their key no longer names the image `sourceUrl` picks); these two
-- statements do what the mirror cannot.
-- 1. The Grand Master Rare scans written before `own_art` existed stay shown.
UPDATE "prints" p SET "external_ids" = jsonb_set(p."external_ids", '{artwork,own_art}', 'true')
FROM "sets" s
WHERE s."id" = p."set_id" AND s."game_id" = 'yugioh' AND p."rarity" = 'Grand Master Rare'
  AND p."external_ids" ? 'artwork' AND coalesce(p."external_ids" #>> '{artwork,alt}', '') = '';--> statement-breakpoint
UPDATE "print_localizations" l SET "external_ids" = jsonb_set(l."external_ids", '{artwork,own_art}', 'true')
FROM "prints" p JOIN "sets" s ON s."id" = p."set_id"
WHERE p."id" = l."print_id" AND s."game_id" = 'yugioh' AND p."rarity" = 'Grand Master Rare'
  AND l."external_ids" ? 'artwork' AND coalesce(l."external_ids" #>> '{artwork,alt}', '') = '';--> statement-breakpoint
-- 2. A localization's key is always a scan (YGOPRODeck's render is on the print): one of the
-- standard artwork is dropped, so the language shows the print's render.
UPDATE "print_localizations" l SET "image_key" = NULL
FROM "prints" p JOIN "sets" s ON s."id" = p."set_id"
WHERE p."id" = l."print_id" AND s."game_id" = 'yugioh' AND l."image_key" IS NOT NULL
  AND l."external_ids" ? 'artwork' AND coalesce(l."external_ids" #>> '{artwork,alt}', '') = ''
  AND coalesce(l."external_ids" #>> '{artwork,own_art}', '') <> 'true';
