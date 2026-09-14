-- Reorder 2.0: which facilities can send stock to which (JSON list of { from, to } facility ids).
ALTER TABLE "Settings" ADD COLUMN "stockRoutes" JSONB;
