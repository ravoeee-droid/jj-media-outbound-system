import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./AdminShell.module.css";

const navigation = [
  { key: "overview", label: "Übersicht", href: "/dashboard", icon: "⌂" },
  { key: "outbound", label: "Outbound Engine", href: "/dashboard/outbound", icon: "↗" },
  { key: "intelligence", label: "Intelligence", href: "/dashboard/intelligence", icon: "✦" },
  { key: "integrations", label: "Integrationen", href: "/dashboard/integrations", icon: "⌘" },
  { key: "system", label: "Systemstatus", href: "/system", icon: "◉" },
] as const;

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
  return (
    <main className={styles.root}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>JJ</span>
          <div><strong>JJ-Media</strong><small>Growth OS</small></div>
        </div>

        <nav className={styles.nav} aria-label="Admin Navigation">
          <p>Workspace</p>
          {navigation.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={active === item.key ? styles.navActive : styles.navLink}
            >
              <span>{item.icon}</span>{item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarBottom}>
          <div className={styles.statusPill}><i />System online</div>
          <a href="/" className={styles.siteLink}>Website öffnen ↗</a>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.mobileBrand}><span>JJ</span><strong>Growth OS</strong></div>
          <div className={styles.topbarRight}>
            <span className={styles.environment}>LIVE WORKSPACE</span>
            <div className={styles.avatar}>JM</div>
          </div>
        </header>

        <div className={`${styles.content} ${wide ? styles.contentWide : ""}`}>
          <div className={styles.pageHead}>
            <div>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1>{title}</h1>
              {description && <p className={styles.description}>{description}</p>}
            </div>
            {actions && <div className={styles.actions}>{actions}</div>}
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
