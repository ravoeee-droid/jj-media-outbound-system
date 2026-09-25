CREATE TABLE IF NOT EXISTS "research_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "imported_lead_id" uuid,
  "source" text DEFAULT 'web' NOT NULL,
  "source_query" text DEFAULT '' NOT NULL,
  "external_id" text DEFAULT '' NOT NULL,
  "company" text NOT NULL,
  "normalized_company" text NOT NULL,
  "website_url" text DEFAULT '' NOT NULL,
  "domain" text DEFAULT '' NOT NULL,
  "phone" text DEFAULT '' NOT NULL,
  "email" text DEFAULT '' NOT NULL,
  "city" text DEFAULT '' NOT NULL,
  "region" text DEFAULT '' NOT NULL,
  "category" text DEFAULT 'other' NOT NULL,
  "rating_x10" integer DEFAULT 0 NOT NULL,
  "review_count" integer DEFAULT 0 NOT NULL,
  "score" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'new' NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'research_candidates_workspace_id_workspaces_id_fk') THEN
    ALTER TABLE "research_candidates" ADD CONSTRAINT "research_candidates_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'research_candidates_imported_lead_id_leads_id_fk') THEN
    ALTER TABLE "research_candidates" ADD CONSTRAINT "research_candidates_imported_lead_id_leads_id_fk"
      FOREIGN KEY ("imported_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "research_candidates_source_unique" ON "research_candidates" USING btree ("workspace_id","source","external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_candidates_feed_idx" ON "research_candidates" USING btree ("workspace_id","status","score","discovered_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_candidates_domain_idx" ON "research_candidates" USING btree ("workspace_id","domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_candidates_company_idx" ON "research_candidates" USING btree ("workspace_id","normalized_company");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_candidates_imported_lead_idx" ON "research_candidates" USING btree ("imported_lead_id");
--> statement-breakpoint
ALTER TABLE "research_candidates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "research_candidates" FROM anon, authenticated;
