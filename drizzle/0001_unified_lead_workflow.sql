ALTER TABLE "leads" ADD COLUMN "owner_id" uuid;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "created_by_id" uuid;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "assigned_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "instagram_url" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "research_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "validation_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "analysis_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "call_status" text DEFAULT 'not_started' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "email_status" text DEFAULT 'not_started' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "whatsapp_status" text DEFAULT 'not_started' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "next_action" text DEFAULT 'review' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "next_action_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contact_locked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contact_lock_reason" text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE "leads"
SET "instagram_url" = "website_url"
WHERE "instagram_url" = '' AND lower("website_url") LIKE '%instagram.com/%';
--> statement-breakpoint
UPDATE "leads" AS l
SET
  "owner_id" = COALESCE(l."owner_id", w."owner_id"),
  "created_by_id" = COALESCE(l."created_by_id", w."owner_id"),
  "assigned_at" = COALESCE(l."assigned_at", l."updated_at", now())
FROM "workspaces" AS w
WHERE l."workspace_id" = w."id";
--> statement-breakpoint
UPDATE "leads"
SET
  "next_action" = CASE
    WHEN "pipeline_stage" IN ('won', 'lost') THEN 'none'
    WHEN "pipeline_stage" = 'call_booked' THEN 'meeting'
    WHEN "pipeline_stage" IN ('contacted', 'replied') THEN 'follow_up'
    ELSE 'review'
  END,
  "call_status" = CASE WHEN "last_contact_at" IS NOT NULL THEN 'attempted' ELSE "call_status" END,
  "email_status" = CASE WHEN "pipeline_stage" IN ('contacted', 'replied', 'call_booked', 'won') THEN 'sent' ELSE "email_status" END;
--> statement-breakpoint
UPDATE "leads"
SET
  "contact_locked" = true,
  "contact_lock_reason" = CASE
    WHEN "pipeline_stage" = 'lost' THEN 'CRM: lost'
    ELSE 'Bestehende Kontaktsperre'
  END,
  "next_action" = 'none'
WHERE
  "pipeline_stage" = 'lost'
  OR "tags" ? 'opt-out'
  OR "tags" ? 'do-not-contact'
  OR "tags" ? 'gesperrt';
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("workspace_id","owner_id");
--> statement-breakpoint
CREATE INDEX "leads_next_action_idx" ON "leads" USING btree ("workspace_id","next_action_at");
