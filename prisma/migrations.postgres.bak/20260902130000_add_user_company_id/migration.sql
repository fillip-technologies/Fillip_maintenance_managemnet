-- AlterTable: add a direct company link on users
ALTER TABLE "users" ADD COLUMN "company_id" UUID;

-- CreateIndex
CREATE INDEX "users_company_id_idx" ON "users"("company_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing users inherit the company of their client (where they have one)
UPDATE "users" u
SET "company_id" = c."company_id"
FROM "clients" c
WHERE u."client_id" = c."id" AND u."company_id" IS NULL;
