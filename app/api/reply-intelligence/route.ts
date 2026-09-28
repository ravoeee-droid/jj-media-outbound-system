import { z } from "zod";
import { apiError, requirePermission } from "@/lib/workspace";
import { getLatestReplyIntelligence, reviewClassification } from "@/lib/reply-intelligence";

const schema=z.object({
  leadId:z.string().uuid(),
  classificationId:z.string().uuid(),
  action:z.enum(["accept","reject"]),
});

export async function GET(request:Request){
  try{
    const workspace=await requirePermission("manage_leads");
    const leadId=new URL(request.url).searchParams.get("leadId");
    if(!leadId)return Response.json({error:"Lead-ID fehlt."},{status:400});
    return Response.json(await getLatestReplyIntelligence(workspace.workspaceId,leadId),{headers:{"cache-control":"no-store"}});
  }catch(error){return apiError(error)}
}

export async function POST(request:Request){
  try{
    const workspace=await requirePermission("manage_leads");
    const input=schema.parse(await request.json());
    return Response.json(await reviewClassification({
      workspaceId:workspace.workspaceId,
      leadId:input.leadId,
      classificationId:input.classificationId,
      action:input.action,
      reviewer:workspace.user.id,
    }));
  }catch(error){
    if(error instanceof z.ZodError)return Response.json({error:"Ungültige Review-Anfrage."},{status:400});
    return apiError(error);
  }
}
