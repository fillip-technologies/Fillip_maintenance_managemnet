-- Add attachments column to issues table
ALTER TABLE "issues" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
