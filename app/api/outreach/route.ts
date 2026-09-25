import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, leads, outreach, settings, tasks } from "@/db/schema";
import { sendStratoMessage } from "@/lib/strato-mail";
import { defaultSettings, renderEmailHtml, renderTemplate } from "@/lib/templates";
import { hasPermission } from "@/lib/team";
import { apiError, requirePermission } from "@/lib/workspace";

const inputSchema = z.object({
  leadId: z.string().uuid(),
  action: z.enum(["prepare", "send", "mark_sent"]),
  step: z.number().int().min(1).max(3).optional().default(1),
  subject: z.string().trim().min(1).max(240).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  context: z.enum(["default", "info_requested"]).optional().default("default"),
});

function addDays(days: number) {
  const result = new Date();
  result.setDate(result.getDate() + days);
  return result;
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("send_email");
    const input = inputSchema.parse(await request.json());
    const appBaseUrl = new URL(request.url).origin;
    const db = getDb();
    const [lead, settingRows] = await Promise.all([
      db
        .select()
        .from(leads)
        .where(and(eq(leads.id, input.leadId), eq(leads.workspaceId, workspace.workspaceId)))
        .limit(1)
        .then((rows) => rows[0]),
      db.select().from(settings).where(eq(settings.workspaceId, workspace.workspaceId)),
    ]);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    if (!hasPermission(workspace.role, workspace.permissions, "view_all_leads") && lead.ownerId !== workspace.user.id) {
      throw new Error("FORBIDDEN");
    }
    if (!lead.email) return Response.json({ error: "Für diesen Lead fehlt eine E-Mail-Adresse." }, { status: 400 });
    if (lead.pipelineStage === "lost" || lead.tags.some((tag) => ["opt-out", "do-not-contact", "gesperrt"].includes(tag.toLowerCase()))) {
      return Response.json({ error: "Dieser Lead ist für weiteren Kontakt gesperrt." }, { status: 409 });
    }

    const values = { ...defaultSettings, ...Object.fromEntries(settingRows.map((row) => [row.key, row.value])) };
    const infoRequested = input.context === "info_requested" && input.step === 1;
    const baseSubjectTemplate = infoRequested ? values.info_email_subject : values.email_subject;
    const template = input.step === 1
      ? (infoRequested ? values.info_email_body : values.email_body)
      : input.step === 2
        ? values.followup_1_body
        : values.followup_2_body;
    const subject = input.subject || renderTemplate(input.step === 1 ? baseSubjectTemplate : `Re: ${values.email_subject}`, lead, appBaseUrl);
    const body = input.body || renderTemplate(template, lead, appBaseUrl);
    const html = renderEmailHtml(body, lead, appBaseUrl);
    const mailUrl = `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(subject)}`;

    if (input.action === "prepare") {
      return Response.json({
        lead,
        step: input.step,
        subject,
        body,
        html,
        previewImageUrl: `${appBaseUrl}/api/preview/${lead.slug}`,
        friendlyVideoUrl: `${appBaseUrl}/video/${lead.slug}`,
        mailUrl,
      });
    }

    const [existing] = await db
      .select()
      .from(outreach)
      .where(and(eq(outreach.leadId, lead.id), eq(outreach.step, input.step)))
      .limit(1);
    if (existing?.status === "sent") {
      return Response.json({
        ok: true,
        status: "sent",
        alreadySent: true,
        providerMessageId: existing.providerMessageId,
        providerThreadId: existing.providerThreadId,
      });
    }

    let providerMessageId: string | undefined;
    let providerThreadId: string | undefined;
    if (input.action === "send") {
      const [previous] = input.step > 1
        ? await db
            .select()
            .from(outreach)
            .where(and(eq(outreach.leadId, lead.id), eq(outreach.step, input.step - 1)))
            .limit(1)
        : [];
      const message = await sendStratoMessage({
        to: lead.email,
        subject,
        body,
        html,
        threadId: previous?.providerThreadId,
      });
      providerMessageId = message.id;
      providerThreadId = message.threadId;
    }

    if (existing) {
      await db
        .update(outreach)
        .set({
          subject,
          body,
          status: "sent",
          sentAt: new Date(),
          providerMessageId: providerMessageId ?? existing.providerMessageId,
          providerThreadId: providerThreadId ?? existing.providerThreadId,
          updatedAt: new Date(),
        })
        .where(eq(outreach.id, existing.id));
    } else {
      await db.insert(outreach).values({
        workspaceId: workspace.workspaceId,
        leadId: lead.id,
        step: input.step,
        subject,
        body,
        status: "sent",
        sentAt: new Date(),
        providerMessageId,
        providerThreadId,
      });
    }

    await Promise.all([
      db
        .update(leads)
        .set({
          pipelineStage: "contacted",
          emailStatus: "sent",
          nextAction: "follow_up",
          lastContactAt: new Date(),
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(leads.id, lead.id)),
      db.insert(activities).values({
        workspaceId: workspace.workspaceId,
        leadId: lead.id,
        type: "email_sent",
        title: input.action === "send" ? "E-Mail über STRATO gesendet" : "Manueller STRATO-Versand bestätigt",
        detail: subject,
      }),
    ]);

    if (input.step === 1) {
      await db.update(tasks).set({ status: "done", updatedAt: new Date() })
        .where(and(eq(tasks.workspaceId, workspace.workspaceId), eq(tasks.leadId, lead.id), eq(tasks.type, "send_info"), eq(tasks.status, "open")));
      const followups = [
        { step: 2 as const, delay: Number(values.followup_1_delay_days || 2), template: values.followup_1_body, priority: "high" },
        { step: 3 as const, delay: Number(values.followup_2_delay_days || 5), template: values.followup_2_body, priority: "normal" },
      ];
      for (const followup of followups) {
        const dueAt = addDays(followup.delay);
        const followupSubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
        const followupBody = renderTemplate(followup.template, lead, appBaseUrl);
        const [storedFollowup] = await db
          .select()
          .from(outreach)
          .where(and(eq(outreach.leadId, lead.id), eq(outreach.step, followup.step)))
          .limit(1);
        if (!storedFollowup) {
          await db.insert(outreach).values({
            workspaceId: workspace.workspaceId,
            leadId: lead.id,
            step: followup.step,
            subject: followupSubject,
            body: followupBody,
            status: "scheduled",
            scheduledAt: dueAt,
            providerThreadId,
          });
        } else if (storedFollowup.status !== "sent") {
          await db
            .update(outreach)
            .set({
              subject: followupSubject,
              body: followupBody,
              status: "scheduled",
              scheduledAt: dueAt,
              providerThreadId: providerThreadId ?? storedFollowup.providerThreadId,
              updatedAt: new Date(),
            })
            .where(eq(outreach.id, storedFollowup.id));
        }

        const taskTitle = `Follow-up ${followup.step - 1}: ${lead.company}`;
        const [storedTask] = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.leadId, lead.id), eq(tasks.type, "follow_up"), eq(tasks.title, taskTitle)))
          .limit(1);
        if (!storedTask) {
          await db.insert(tasks).values({
            workspaceId: workspace.workspaceId,
            leadId: lead.id,
            assigneeId: lead.ownerId || workspace.user.id,
            title: taskTitle,
            dueAt,
            priority: followup.priority,
            type: "follow_up",
          });
        }
      }
    }

    return Response.json({ ok: true, status: "sent", providerMessageId, providerThreadId });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Outreach-Anfrage." }, { status: 400 });
    return apiError(error);
  }
}
