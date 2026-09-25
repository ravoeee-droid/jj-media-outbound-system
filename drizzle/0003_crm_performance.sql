CREATE INDEX IF NOT EXISTS "leads_crm_updated_idx" ON "leads" USING btree ("workspace_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_crm_owner_updated_idx" ON "leads" USING btree ("workspace_id","owner_id","updated_at");
