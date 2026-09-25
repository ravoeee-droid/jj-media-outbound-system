ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_salt" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assignee_id" uuid;
--> statement-breakpoint
UPDATE "users"
SET "name" = 'Jessica Just', "status" = 'active', "updated_at" = now()
WHERE "email" = 'cockpit@jj-media.local';
--> statement-breakpoint
UPDATE "tasks" AS t
SET "assignee_id" = l."owner_id"
FROM "leads" AS l
WHERE t."lead_id" = l."id"
  AND t."workspace_id" = l."workspace_id"
  AND t."assignee_id" IS NULL
  AND l."owner_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "tasks" AS t
SET "assignee_id" = w."owner_id"
FROM "workspaces" AS w
WHERE t."workspace_id" = w."id"
  AND t."assignee_id" IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assignee_id_users_id_fk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk"
      FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_idx" ON "tasks" USING btree ("workspace_id","assignee_id","status","due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_user_idx" ON "tasks" USING btree ("assignee_id");
