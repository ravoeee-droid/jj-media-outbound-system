import { z } from "zod";
import { deleteStoredStratoCredentials, saveStoredStratoCredentials } from "@/lib/strato-credentials";
import { getStratoMailStatus, testStratoCredentials } from "@/lib/strato-mail";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const saveSchema = z.object({
  action: z.literal("save"),
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(500),
  senderName: z.string().trim().min(1).max(120).optional().default("JJ-Media"),
});

const deleteSchema = z.object({ action: z.literal("delete") });
const inputSchema = z.discriminatedUnion("action", [saveSchema, deleteSchema]);

export async function GET() {
  try {
    const workspace = await requirePermission("manage_settings");
    const status = await getStratoMailStatus(workspace.workspaceId);
    return Response.json({
      configured: status.configured,
      email: status.email,
      source: status.source,
      imap: status.imapHost + ":" + status.imapPort,
      smtp: status.smtpHost + ":" + status.smtpPort,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("manage_settings");
    const input = inputSchema.parse(await request.json());

    if (input.action === "delete") {
      await deleteStoredStratoCredentials(workspace.workspaceId);
      const status = await getStratoMailStatus(workspace.workspaceId);
      return Response.json({ ok: true, configured: status.configured, source: status.source, email: status.email });
    }

    const tested = await testStratoCredentials({
      email: input.email,
      password: input.password,
      senderName: input.senderName,
    });

    await saveStoredStratoCredentials(workspace.workspaceId, {
      email: input.email,
      password: input.password,
      senderName: input.senderName,
    });

    return Response.json({
      ok: true,
      configured: true,
      email: tested.email,
      imapHost: tested.imapHost,
      smtpHost: tested.smtpHost,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "STRATO-Zugangsdaten sind unvollständig.", issues: error.issues }, { status: 400 });
    }
    return apiError(error);
  }
}
