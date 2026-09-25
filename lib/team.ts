export const TEAM_ROLES = ["owner", "admin", "sales", "setter", "research", "viewer"] as const;
export type TeamRole = typeof TEAM_ROLES[number];

export const TEAM_PERMISSIONS = [
  "view_own_leads",
  "view_all_leads",
  "manage_leads",
  "send_email",
  "use_whatsapp",
  "generate_video",
  "book_meetings",
  "manage_team",
  "manage_settings",
  "view_kpis",
] as const;

export type TeamPermission = typeof TEAM_PERMISSIONS[number];

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  sales: "Vertrieb",
  setter: "Setter",
  research: "Recherche",
  viewer: "Nur lesen",
};

export const PERMISSION_LABELS: Record<TeamPermission, string> = {
  view_own_leads: "Eigene Leads sehen",
  view_all_leads: "Team-Leads sehen",
  manage_leads: "Leads bearbeiten",
  send_email: "E-Mails senden",
  use_whatsapp: "WhatsApp nutzen",
  generate_video: "Videos erstellen",
  book_meetings: "Termine buchen",
  manage_team: "Mitarbeiter verwalten",
  manage_settings: "Einstellungen ändern",
  view_kpis: "KPIs sehen",
};

export const ROLE_DEFAULTS: Record<TeamRole, TeamPermission[]> = {
  owner: [...TEAM_PERMISSIONS],
  admin: [...TEAM_PERMISSIONS],
  sales: ["view_own_leads", "view_all_leads", "manage_leads", "send_email", "use_whatsapp", "generate_video", "book_meetings", "view_kpis"],
  setter: ["view_own_leads", "view_all_leads", "manage_leads", "send_email", "use_whatsapp", "book_meetings", "view_kpis"],
  research: ["view_own_leads", "view_all_leads", "manage_leads", "generate_video"],
  viewer: ["view_own_leads"],
};

export function normalizedRole(value: string): TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value) ? value as TeamRole : "viewer";
}

export function normalizedPermissions(role: TeamRole, permissions?: string[] | null) {
  const valid = new Set(TEAM_PERMISSIONS);
  const requested = (permissions ?? []).filter((permission): permission is TeamPermission => valid.has(permission as TeamPermission));
  if (role === "owner") return [...TEAM_PERMISSIONS];
  if (permissions !== undefined && permissions !== null) return [...new Set(requested)];
  return [...ROLE_DEFAULTS[role]];
}

export function hasPermission(role: string, permissions: string[], permission: TeamPermission) {
  const normalized = normalizedRole(role);
  return normalized === "owner" || normalized === "admin" || permissions.includes(permission);
}
