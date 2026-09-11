-- Zone name uniqueness was previously enforced globally per client.
-- This was too strict: the same room name (e.g. "Keeper Room") should be
-- allowed under different parent zones. We split it into two partial indexes:
--   1. Top-level zones (parent_zone_id IS NULL): unique per client.
--   2. Sub-zones (parent_zone_id IS NOT NULL): unique per parent zone.

DROP INDEX IF EXISTS "zones_client_name_unique";

CREATE UNIQUE INDEX "zones_toplevel_name_unique"
  ON "zones" ("client_id", lower("name"))
  WHERE "parent_zone_id" IS NULL;

CREATE UNIQUE INDEX "zones_subzone_name_unique"
  ON "zones" ("client_id", "parent_zone_id", lower("name"))
  WHERE "parent_zone_id" IS NOT NULL;
