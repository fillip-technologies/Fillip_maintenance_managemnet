-- Unify "Product" onto Device (the tracked hardware unit).
-- Additive columns + nullable zone (in-stock units) + global ProductCategory.

-- CreateTable: global product categories (shared across all orgs, CEO-managed)
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_categories_name_key" ON "product_categories"("name");
CREATE UNIQUE INDEX "product_categories_code_key" ON "product_categories"("code");

-- AlterTable: extend Device into the unified unit
ALTER TABLE "devices" ADD COLUMN "company_id" UUID;
ALTER TABLE "devices" ADD COLUMN "category_id" UUID;
ALTER TABLE "devices" ADD COLUMN "code" VARCHAR(40);
ALTER TABLE "devices" ADD COLUMN "unit_price" DECIMAL(12,2);
ALTER TABLE "devices" ADD COLUMN "purchase_date" DATE;
ALTER TABLE "devices" ADD COLUMN "image_url" TEXT;

-- zone_id becomes nullable (null = in stock); drop the old Cascade FK and re-add as SetNull
ALTER TABLE "devices" ALTER COLUMN "zone_id" DROP NOT NULL;
ALTER TABLE "devices" DROP CONSTRAINT "devices_zone_id_fkey";
ALTER TABLE "devices" ADD CONSTRAINT "devices_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New FKs
ALTER TABLE "devices" ADD CONSTRAINT "devices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique code + helpful indexes
CREATE UNIQUE INDEX "devices_code_key" ON "devices"("code");
CREATE INDEX "devices_company_id_idx" ON "devices"("company_id");
CREATE INDEX "devices_category_id_idx" ON "devices"("category_id");

-- Backfill: existing devices inherit the company of their zone's client
UPDATE "devices" d
SET "company_id" = c."company_id"
FROM "zones" z
JOIN "clients" c ON z."client_id" = c."id"
WHERE d."zone_id" = z."id" AND d."company_id" IS NULL;
