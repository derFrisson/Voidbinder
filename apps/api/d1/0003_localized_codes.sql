-- VB-94: a Yu-Gi-Oh! localization's code as printed (`LON-G065`, print_localizations.external_ids
-- .set_code) and in lower case, letters and digits only (`long065`), for the code search.
-- One statement per line: the tests apply this file statement by statement.
ALTER TABLE names ADD COLUMN code TEXT;
ALTER TABLE names ADD COLUMN code_alnum TEXT;
CREATE INDEX names_code_alnum ON names (code_alnum);
