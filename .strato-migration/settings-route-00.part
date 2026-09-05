import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assets, settings } from "@/db/schema";
import { defaultSettings } from "@/lib/templates";
import { stratoMailStatus } from "@/lib/strato-mail";
import { apiError, requireWorkspace } from "@/lib/workspace";

const allowed = new Set([
  "calendar_embed_url",
  "sender_name",
  "sender_email",
  "email_subject",
  "email_body",
  "followup_1_body",
  "followup_2_body",
  "offer_name",
  "booking_cta",
  "auto_followups",
  "followup_1_delay_days",
  "followup_2_delay_days",
  "landing_studio_config",
]);

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    const db = getDb();
    const [rows, masterVideo] = await Promise.all([
      db.select().from(settings).where(eq(settings.workspaceId, workspace.workspaceId)),
      db.select().from(assets).where(and(eq(assets.workspaceId, workspace.workspaceId), eq(assets.kind, "master_video"))).orderBy(desc(assets.createdAt)).limit(1),
    ]);
    const values = { ...defaultSettings, ...Object.fromEntries(rows.map((row) => [row.key, row.value])) };
    const mail = stratoMailStatus();
    return Response.json({
      settings: values,
      integrations: {
        screenshotOne: true,
        calendar: Boolean(values.calendar_embed_url),
        masterVideo: Boolean(masterVideo[0]),
        mail: mail.configured,
        database: Boolean(process.env.DATABASE_URL),
        blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      },
      mail: { provider: "strato", configured: mail.configured, email: mail.email },
      masterVideo: masterVideo[0] ?? null,
    });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const payload = (await request.json()) as Record<string, unknown>;
    const db = getDb();
    for (const [key, value] of Object.entries(payload)) {
      if ((!allowed.has(key) && !key.startsWith("landing_studio_config:")) || typeof value !== "string") continue;
      await db.insert(settings).values({ workspaceId, key, value: value.trim() }).onConflictDoUpdate({
        target: [settings.workspaceId, settings.key],
        set: { value: value.trim(), updatedAt: new Date() },
      });
    }
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
