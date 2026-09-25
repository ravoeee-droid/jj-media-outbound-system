"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./TeamWorkspace.module.css";

type PermissionMeta = { value: string; label: string };
type RoleMeta = { value: string; label: string; permissions: string[] };
type Member = {
  userId: string;
  name: string | null;
  email: string | null;
  status: string;
  lastLoginAt?: string | null;
  role: string;
  permissions: string[];
  leadCount: number;
  openTaskCount: number;
  calendarConnected?: boolean;
  isCurrentUser?: boolean;
};

type Payload = {
  members?: Member[];
  meta?: { roles: RoleMeta[]; permissions: PermissionMeta[] };
  error?: string;
};

const initialForm = { name: "", email: "", password: "", role: "sales", permissions: [] as string[] };

function initials(name: string | null, email: string | null) {
  const value = (name || email || "JJ").trim();
  const parts = value.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : value.slice(0, 2)).toUpperCase();
}

function formatLastLogin(value?: string | null) {
  if (!value) return "Noch nie angemeldet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Noch nie angemeldet";
  return "Zuletzt " + new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function TeamWorkspace() {
  const [data, setData] = useState<Payload>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("sales");
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState<"active" | "inactive">("active");
  const [editPassword, setEditPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  async function refresh() {
    const response = await fetch("/api/team", { cache: "no-store" });
    const payload = await response.json() as Payload;
    if (!response.ok) throw new Error(payload.error || "Team konnte nicht geladen werden.");
    setData(payload);
    if (!form.permissions.length && payload.meta?.roles?.length) {
      const role = payload.meta.roles.find((item) => item.value === form.role);
      if (role) setForm((current) => ({ ...current, permissions: role.permissions }));
    }
  }

  useEffect(() => {
    refresh().catch((error) => setToast(error instanceof Error ? error.message : "Team konnte nicht geladen werden.")).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleMap = useMemo(() => new Map((data.meta?.roles || []).map((role) => [role.value, role])), [data.meta?.roles]);

  function changeCreateRole(role: string) {
    setForm((current) => ({ ...current, role, permissions: roleMap.get(role)?.permissions || [] }));
  }

  function togglePermission(value: string, mode: "create" | "edit") {
    if (mode === "create") {
      setForm((current) => ({ ...current, permissions: current.permissions.includes(value) ? current.permissions.filter((permission) => permission !== value) : [...current.permissions, value] }));
      return;
    }
    setEditPermissions((current) => current.includes(value) ? current.filter((permission) => permission !== value) : [...current, value]);
  }

  async function createMember(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setToast("");
    try {
      const response = await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Mitarbeiter konnte nicht angelegt werden.");
      setShowCreate(false);
      setForm({ ...initialForm, permissions: roleMap.get("sales")?.permissions || [] });
      await refresh();
      setToast("Mitarbeiter angelegt. Der Zugang ist sofort aktiv.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Mitarbeiter konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(member: Member) {
    setEditId(member.userId);
    setEditName(member.name || "");
    setEditRole(member.role);
    setEditPermissions(member.permissions);
    setEditStatus(member.status === "inactive" ? "inactive" : "active");
    setEditPassword("");
  }

  function changeEditRole(role: string) {
    setEditRole(role);
    setEditPermissions(roleMap.get(role)?.permissions || []);
  }

  async function saveMember(member: Member) {
    if (member.role === "owner") return;
    setBusy(true);
    setToast("");
    try {
      const response = await fetch("/api/team", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: member.userId,
          name: editName,
          role: editRole,
          permissions: editPermissions,
          status: editStatus,
          ...(editPassword ? { password: editPassword } : {}),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Änderungen konnten nicht gespeichert werden.");
      setEditId(null);
      await refresh();
      setToast("Mitarbeiter aktualisiert.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Änderungen konnten nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className={styles.loading}>Team wird geladen …</div>;

  return (
    <div className={styles.root}>
      <section className={styles.summary}>
        <div><small>TEAM</small><strong>{data.members?.filter((member) => member.status === "active").length || 0}</strong><span>aktive Zugänge</span></div>
        <div><small>LEADS</small><strong>{data.members?.reduce((sum, member) => sum + member.leadCount, 0) || 0}</strong><span>zugeordnet</span></div>
        <div><small>AUFGABEN</small><strong>{data.members?.reduce((sum, member) => sum + member.openTaskCount, 0) || 0}</strong><span>offen</span></div>
        <button className={styles.primary} onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Schließen" : "+ Mitarbeiter anlegen"}</button>
      </section>

      {toast && <div className={styles.toast}>{toast}</div>}

      {showCreate && (
        <form className={styles.editor} onSubmit={createMember}>
          <div className={styles.editorHead}><div><small>NEUER ZUGANG</small><h2>Mitarbeiter anlegen</h2><p>Eigener Login, klare Rolle und nur die Rechte, die wirklich gebraucht werden.</p></div></div>
          <div className={styles.formGrid}>
            <label><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="z. B. Anna Müller" required /></label>
            <label><span>E-Mail</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="anna@jj-media.de" required /></label>
            <label><span>Temporäres Passwort</span><input type="password" minLength={10} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mindestens 10 Zeichen" required /></label>
            <label><span>Rolle</span><select value={form.role} onChange={(event) => changeCreateRole(event.target.value)}>{data.meta?.roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
          </div>
          <PermissionGrid permissions={data.meta?.permissions || []} selected={form.permissions} onToggle={(value) => togglePermission(value, "create")} />
          <div className={styles.editorActions}><button type="button" onClick={() => setShowCreate(false)}>Abbrechen</button><button className={styles.primary} disabled={busy}>{busy ? "Wird angelegt …" : "Zugang anlegen"}</button></div>
        </form>
      )}

      <section className={styles.members}>
        {data.members?.map((member) => {
          const editing = editId === member.userId;
          const roleLabel = member.role === "owner" ? "Owner" : roleMap.get(member.role)?.label || member.role;
          return (
            <article className={styles.member + (member.status === "inactive" ? " " + styles.inactive : "")} key={member.userId}>
              <div className={styles.identity}>
                <span className={styles.avatar}>{initials(member.name, member.email)}</span>
                <div><div className={styles.nameLine}><strong>{member.name || member.email}</strong>{member.isCurrentUser && <em>DU</em>}</div><small>{member.email}</small><span>{formatLastLogin(member.lastLoginAt)} · {member.calendarConnected ? "Kalender verbunden" : "Kalender offen"}</span></div>
              </div>
              <div className={styles.stats}><div><strong>{member.leadCount}</strong><span>Leads</span></div><div><strong>{member.openTaskCount}</strong><span>Aufgaben</span></div></div>
              <div className={styles.role}><span>{roleLabel}</span><small>{member.status === "active" ? "Aktiv" : "Deaktiviert"}</small></div>
              <button className={styles.secondary} disabled={member.role === "owner"} onClick={() => editing ? setEditId(null) : beginEdit(member)}>{member.role === "owner" ? "Workspace Owner" : editing ? "Schließen" : "Bearbeiten"}</button>

              {editing && member.role !== "owner" && (
                <div className={styles.memberEditor}>
                  <div className={styles.formGrid}>
                    <label><span>Name</span><input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
                    <label><span>Rolle</span><select value={editRole} onChange={(event) => changeEditRole(event.target.value)}>{data.meta?.roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                    <label><span>Status</span><select value={editStatus} onChange={(event) => setEditStatus(event.target.value as "active" | "inactive")}><option value="active">Aktiv</option><option value="inactive">Deaktiviert</option></select></label>
                    <label><span>Neues Passwort (optional)</span><input type="password" minLength={10} value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder="Nur zum Zurücksetzen ausfüllen" /></label>
                  </div>
                  <PermissionGrid permissions={data.meta?.permissions || []} selected={editPermissions} onToggle={(value) => togglePermission(value, "edit")} />
                  <div className={styles.editorActions}><button type="button" onClick={() => setEditId(null)}>Abbrechen</button><button className={styles.primary} disabled={busy} onClick={() => void saveMember(member)}>{busy ? "Speichert …" : "Änderungen speichern"}</button></div>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function PermissionGrid({ permissions, selected, onToggle }: { permissions: PermissionMeta[]; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <fieldset className={styles.permissions}>
      <legend>Rechte</legend>
      <div>{permissions.map((permission) => <label key={permission.value} className={selected.includes(permission.value) ? styles.permissionActive : ""}><input type="checkbox" checked={selected.includes(permission.value)} onChange={() => onToggle(permission.value)} /><span>{permission.label}</span></label>)}</div>
    </fieldset>
  );
}
