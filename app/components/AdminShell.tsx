"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import styles from "./AdminShell.module.css";
import { ROLE_LABELS, hasPermission, normalizedRole, type TeamPermission } from "@/lib/team";

type IconName = "home" | "send" | "spark" | "plug" | "pulse" | "chat" | "mail" | "team";
type NavKey = "overview" | "outbound" | "email" | "whatsapp" | "intelligence" | "team" | "integrations" | "system";
type NavItem = { key: NavKey; label: string; hint: string; href: string; icon: IconName; permission?: TeamPermission };

const navigation: readonly NavItem[] = [
  { key: "overview", label: "Übersicht", hint: "Command Center", href: "/dashboard", icon: "home" },
  { key: "outbound", label: "Outbound", hint: "Leads & Videos", href: "/dashboard/outbound", icon: "send", permission: "view_own_leads" },
  { key: "email", label: "E-Mail", hint: "Inbox & Threads", href: "/dashboard/email", icon: "mail", permission: "send_email" },
  { key: "whatsapp", label: "WhatsApp", hint: "Inbox & KI-Agent", href: "/dashboard/whatsapp", icon: "chat", permission: "use_whatsapp" },
  { key: "intelligence", label: "Intelligence", hint: "Chancen & Signale", href: "/dashboard/intelligence", icon: "spark", permission: "view_kpis" },
  { key: "team", label: "Team", hint: "Mitarbeiter & Rechte", href: "/dashboard/team", icon: "team", permission: "manage_team" },
  { key: "integrations", label: "Integrationen", hint: "Datenquellen", href: "/dashboard/integrations", icon: "plug", permission: "manage_settings" },
  { key: "system", label: "System", hint: "Status & Technik", href: "/system", icon: "pulse", permission: "manage_settings" },
];

function Icon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "home") return <svg {...common}><path d="M3.5 10.5 12 3.7l8.5 6.8"/><path d="M5.8 9.2v10.2h12.4V9.2"/><path d="M9.6 19.4v-6h4.8v6"/></svg>;
  if (name === "send") return <svg {...common}><path d="m4 4 16 7.2-7 2.1-2.2 6.7L4 4Z"/><path d="m11 13 4.8-4.8"/></svg>;
  if (name === "mail") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4.5 7 7.5 6 7.5-6"/></svg>;
  if (name === "spark") return <svg {...common}><path d="M12 2.8 14 9l6.2 2-6.2 2-2 6.2-2-6.2-6.2-2 6.2-2 2-6.2Z"/><path d="m19 3 .7 2.2L22 6l-2.3.8L19 9l-.8-2.2L16 6l2.2-.8L19 3Z"/></svg>;
  if (name === "plug") return <svg {...common}><path d="M8 3v5M16 3v5"/><path d="M6 8h12v2a6 6 0 0 1-6 6v5"/><path d="M9 21h6"/></svg>;
  if (name === "chat") return <svg {...common}><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-10.5A9.5 9.5 0 0 1 12 2a9 9 0 0 1 9 9.5Z"/><path d="M7 10h9M7 14h6"/></svg>;
  if (name === "team") return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  return <svg {...common}><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>;
}

export default function AdminShell({
  active,
  eyebrow,
  title,
  description,
  actions,
  children,
  wide = false,
}: {
  active: NavKey;
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || "/";
  const [identity, setIdentity] = useState<{ name: string | null; email: string | null; role: string; permissions: string[] } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Session unavailable")))
      .then((payload: { user?: { name: string | null; email: string | null; role: string; permissions: string[] } }) => {
        if (active && payload.user) setIdentity(payload.user);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const role = normalizedRole(identity?.role || "viewer");
  const visibleNavigation = useMemo(
    () => identity
      ? navigation.filter((item) => !item.permission || hasPermission(role, identity.permissions, item.permission))
      : navigation.filter((item) => item.key === "overview"),
    [identity, role],
  );
  const displayName = identity?.name || identity?.email || "JJ-Media Team";
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "JJ";

  return (
    <main className={styles.root}>
      <aside className={styles.sidebar}>
        <Link href="/dashboard" className={styles.brand} aria-label="JJ-Media Growth OS Startseite">
          <span className={styles.brandMark}>JJ</span>
          <span className={styles.brandCopy}><strong>JJ—MEDIA</strong><small>Growth OS</small></span>
        </Link>

        <div className={styles.workspaceLabel}>
          <span className={styles.liveDot} />
          <div><strong>Workspace aktiv</strong><small>Outbound · CRM · Intelligence</small></div>
        </div>

        <nav className={styles.nav} aria-label="Admin Navigation">
          <p>Workspace</p>
          {visibleNavigation.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={active === item.key ? styles.navActive : styles.navLink}
              aria-current={active === item.key ? "page" : undefined}
            >
              <span className={styles.navIcon}><Icon name={item.icon} /></span>
              <span className={styles.navCopy}><strong>{item.label}</strong><small>{item.hint}</small></span>
              <span className={styles.navArrow}>↗</span>
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarBottom}>
          <div className={styles.ownerCard}>
            <span className={styles.avatar}>{initials}</span>
            <div><strong>{displayName}</strong><small>{identity ? ROLE_LABELS[role] : "Team"}</small></div>
          </div>
          <a href={publicSiteUrl} className={styles.siteLink}>Website ansehen <span>↗</span></a>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.mobileBrand}><span>JJ</span><div><strong>JJ—MEDIA</strong><small>Growth OS</small></div></div>
          <div className={styles.topbarContext}><span className={styles.liveDot} /><span>Live Workspace</span><i /> <strong>{navigation.find((item) => item.key === active)?.label}</strong></div>
          <div className={styles.topbarRight}>
            <a href={publicSiteUrl} className={styles.previewLink}>Website <span>↗</span></a>
            <span className={styles.environment}>LIVE</span>
            <div className={styles.avatar}>{initials}</div>
          </div>
        </header>

        <div className={`${styles.content} ${wide ? styles.contentWide : ""}`}>
          <div className={styles.pageHead}>
            <div className={styles.pageIntro}>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1>{title}</h1>
              {description && <p className={styles.description}>{description}</p>}
            </div>
            {actions && <div className={styles.actions}>{actions}</div>}
          </div>
          {children}
        </div>
      </section>

      <nav className={styles.mobileNav} aria-label="Mobile Admin Navigation">
        {visibleNavigation.map((item) => (
          <Link key={item.key} href={item.href} className={active === item.key ? styles.mobileNavActive : styles.mobileNavLink} aria-current={active === item.key ? "page" : undefined}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}