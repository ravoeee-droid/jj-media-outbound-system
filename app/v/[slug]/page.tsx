import { notFound } from "next/navigation";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { and, desc, eq } from "drizzle-orm";
import LeadLanding from "../../components/LeadLanding";
import { assertDatabaseConfigured, getDb } from "../../../db";
import { assets, leads } from "../../../db/schema";

export default async function PersonalizedLeadPage({ params }: { params: Promise<{ slug: string }> }) {
  assertDatabaseConfigured();
  const { slug } = await params;
  const db = getDb();
  const [lead] = await db
    .select({ id: leads.id, company: leads.company, workspaceId: leads.workspaceId })
    .from(leads)
    .where(eq(leads.slug, slug))
    .limit(1);
  if (!lead) notFound();

  let initialVideoUrl: string | null = null;
  const [renderedVideo] = await db
    .select({ pathname: assets.pathname })
    .from(assets)
    .where(and(eq(assets.workspaceId, lead.workspaceId), eq(assets.kind, `rendered_video:${lead.id}`)))
    .orderBy(desc(assets.createdAt))
    .limit(1);
  if (renderedVideo) {
    const validUntil = Date.now() + 6 * 60 * 60 * 1000;
    const token = await issueSignedToken({
      pathname: renderedVideo.pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(token, {
      pathname: renderedVideo.pathname,
      operation: "get",
      access: "private",
      validUntil,
    });
    initialVideoUrl = presignedUrl;
  }

  return <LeadLanding company={lead.company} slug={slug} initialVideoUrl={initialVideoUrl} />;
}
