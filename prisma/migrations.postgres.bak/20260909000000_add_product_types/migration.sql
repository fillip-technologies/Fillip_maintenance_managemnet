-- CreateTable
CREATE TABLE "product_types" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID         NOT NULL,
    "name"        VARCHAR(120) NOT NULL,
    "image_url"   TEXT,
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_types_category_id_name_key" UNIQUE ("category_id", "name")
);

-- CreateIndex
CREATE INDEX "product_types_category_id_idx" ON "product_types"("category_id");

-- AddForeignKey
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "devices" ADD COLUMN "product_type_id" UUID;

-- CreateIndex
CREATE INDEX "devices_product_type_id_idx" ON "devices"("product_type_id");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_product_type_id_fkey"
    FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
