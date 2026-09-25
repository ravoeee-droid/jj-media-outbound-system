import { apiError, requireWorkspace } from "@/lib/workspace";

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    return Response.json({
      user: {
        id: workspace.user.id,
        name: workspace.user.name,
        email: workspace.user.email,
        role: workspace.role,
        permissions: workspace.permissions,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
