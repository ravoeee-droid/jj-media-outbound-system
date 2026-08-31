import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts } from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

export async function DELETE() {
  try {
    const workspace = await requireWorkspace();
    await getDb()
      .delete(accounts)
      .where(and(eq(accounts.userId, workspace.user.id), eq(accounts.provider, "google")));
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
