-- Retie issue categories to the global ProductCategory instead of HardwareType.
-- issue_categories is empty, so the column swap is safe (no data to migrate).

-- Drop the old hardware_type link
ALTER TABLE "issue_categories" DROP CONSTRAINT IF EXISTS "issue_categories_hardware_type_id_fkey";
DROP INDEX IF EXISTS "issue_categories_hardware_type_id_idx";
ALTER TABLE "issue_categories" DROP COLUMN IF EXISTS "hardware_type_id";

-- Add the product-category link (nullable = global, applies to any unit)
ALTER TABLE "issue_categories" ADD COLUMN "category_id" UUID;
CREATE INDEX "issue_categories_category_id_idx" ON "issue_categories"("category_id");
ALTER TABLE "issue_categories" ADD CONSTRAINT "issue_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
