import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./AdminShell.module.css";

type IconName = "home" | "send" | "spark" | "plug" | "pulse";

const navigation = [
  { key: "overview", label: "Übersicht", hint: "Command Center", href: "/dashboard", icon: "home" },
  { key: "outbound", label: "Outbound", hint: "Leads & Videos", href: "/dashboard/outbound", icon: "send" },
  { key: "intelligence", label: "Intelligence", hint: "Chancen & Signale", href: "/dashboard/intelligence", icon: "spark" },
  { key: "integrations", label: "Integrationen", hint: "Datenquellen", href: "/dashboard/integrations", icon: "plug" },
  { key: "system", label: "System", hint: "Status & Technik", href: "/system", icon: "pulse" },
] as const satisfies ReadonlyArray<{ key: string; label: string; hint: string; href: string; icon: IconName }>;

function Icon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "home") return <svg {...common}><path d="M3.5 10.5 12 3.7l8.5 6.8"/><path d="M5.8 9.2v10.2h12.4V9.2"/><path d="M9.6 19.4v-6h4.8v6"/></svg>;
  if (name === "send") return <svg {...common}><path d="m4 4 16 7.2-7 2.1-2.2 6.7L4 4Z"/><path d="m11 13 4.8-4.8"/></svg>;
  if (name === "spark") return <svg {...common}><path d="M12 2.8 14 9l6.2 2-6.2 2-2 6.2-2-6.2-6.2-2 6.2-2 2-6.2Z"/><path d="m19 3 .7 2.2L22 6l-2.3.8L19 9l-.8-2.2L16 6l2.2-.8L19 3Z"/></svg>;
  if (name === "plug") return <svg {...common}><path d="M8 3v5M16 3v5"/><path d="M6 8h12v2a6 6 0 0 1-6 6v5"/><path d="M9 21h6"/></svg>;
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
  active: (typeof navigation)[number]["key"];
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || "/";

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
          {navigation.map((item) => (
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
            <span className={styles.avatar}>JJ</span>
            <div><strong>Jessica Just</strong><small>JJ-Media Admin</small></div>
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
            <div className={styles.avatar}>JJ</div>
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
        {navigation.map((item) => (
          <Link key={item.key} href={item.href} className={active === item.key ? styles.mobileNavActive : styles.mobileNavLink} aria-current={active === item.key ? "page" : undefined}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
