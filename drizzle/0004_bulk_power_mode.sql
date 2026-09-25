CREATE INDEX IF NOT EXISTS "jobs_workspace_type_idx" ON "jobs" USING btree ("workspace_id","type","status","lead_id");
