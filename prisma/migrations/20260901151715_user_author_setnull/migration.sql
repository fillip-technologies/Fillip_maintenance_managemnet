-- Make the five "author" foreign keys nullable and switch them to ON DELETE SET
-- NULL. This lets client users be hard-deleted while the records they authored
-- (zones, devices, issues, status changes, daily logs) survive with a null author.

-- zones.created_by
ALTER TABLE "zones" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "zones" DROP CONSTRAINT "zones_created_by_fkey";
ALTER TABLE "zones" ADD CONSTRAINT "zones_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- devices.added_by
ALTER TABLE "devices" ALTER COLUMN "added_by" DROP NOT NULL;
ALTER TABLE "devices" DROP CONSTRAINT "devices_added_by_fkey";
ALTER TABLE "devices" ADD CONSTRAINT "devices_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- issues.raised_by_user_id
ALTER TABLE "issues" ALTER COLUMN "raised_by_user_id" DROP NOT NULL;
ALTER TABLE "issues" DROP CONSTRAINT "issues_raised_by_user_id_fkey";
ALTER TABLE "issues" ADD CONSTRAINT "issues_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- issue_status_history.changed_by_user_id
ALTER TABLE "issue_status_history" ALTER COLUMN "changed_by_user_id" DROP NOT NULL;
ALTER TABLE "issue_status_history" DROP CONSTRAINT "issue_status_history_changed_by_user_id_fkey";
ALTER TABLE "issue_status_history" ADD CONSTRAINT "issue_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- daily_status_logs.logged_by_user_id
ALTER TABLE "daily_status_logs" ALTER COLUMN "logged_by_user_id" DROP NOT NULL;
ALTER TABLE "daily_status_logs" DROP CONSTRAINT "daily_status_logs_logged_by_user_id_fkey";
ALTER TABLE "daily_status_logs" ADD CONSTRAINT "daily_status_logs_logged_by_user_id_fkey" FOREIGN KEY ("logged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
