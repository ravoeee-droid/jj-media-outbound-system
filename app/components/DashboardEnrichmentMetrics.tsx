"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type ApiLead = {
  tags?: unknown;
};

type DashboardStats = {
  total: number;
  enriched: number;
};

function hasManualEnrichmentTag(lead: ApiLead) {
  return Array.isArray(lead.tags)
    && lead.tags.some((tag) => String(tag).trim().toLowerCase() === "manuell-enriched");
}

function createMount(selector: string, portalName: string) {
  const container = document.querySelector<HTMLElement>(selector);
  if (!container) return null;

  const existing = container.querySelector<HTMLElement>(`[data-dashboard-enrichment-portal="${portalName}"]`);
  if (existing) return existing;

  const mount = document.createElement("div");
  mount.dataset.dashboardEnrichmentPortal = portalName;
  mount.style.display = "contents";

  const firstRealChild = Array.from(container.children).find(
    (child) => !(child instanceof HTMLElement && child.dataset.dashboardEnrichmentPortal),
  );

  if (firstRealChild) firstRealChild.after(mount);
  else container.appendChild(mount);

  return mount;
}

export default function DashboardEnrichmentMetrics() {
  const [metricMount, setMetricMount] = useState<HTMLElement | null>(null);
  const [pipelineMount, setPipelineMount] = useState<HTMLElement | null>(null);
  const [stats, setStats] = useState<DashboardStats>({ total: 0, enriched: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let metricNode: HTMLElement | null = null;
    let pipelineNode: HTMLElement | null = null;

    const attach = () => {
      if (!metricNode || !metricNode.isConnected) {
        metricNode = createMount(".metric-grid", "metric");
        if (metricNode) setMetricMount(metricNode);
      }
      if (!pipelineNode || !pipelineNode.isConnected) {
        pipelineNode = createMount(".pipeline", "pipeline");
        if (pipelineNode) setPipelineMount(pipelineNode);
      }
    };

    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      metricNode?.remove();
      pipelineNode?.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadStats() {
      try {
        const response = await fetch("/api/leads", { cache: "no-store" });
        if (!response.ok) throw new Error("Kennzahlen konnten nicht geladen werden.");
        const payload = await response.json() as { leads?: ApiLead[] };
        const leads = payload.leads || [];
        if (!active) return;
        setStats({
          total: leads.length,
          enriched: leads.filter(hasManualEnrichmentTag).length,
        });
        setLoaded(true);
      } catch {
        if (active) setLoaded(true);
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadStats();
    };

    void loadStats();
    window.addEventListener("focus", loadStats);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.removeEventListener("focus", loadStats);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const percentage = useMemo(
    () => stats.total > 0 ? Math.round((stats.enriched / stats.total) * 100) : 0,
    [stats],
  );

  const metricCard = metricMount
    ? createPortal(
      <article className="metric-card dashboard-enrichment-card">
        <div className="metric-card__label">
          <span>Leads angereichert</span>
          <span className="metric-icon dashboard-enrichment-icon" aria-hidden="true">✦</span>
        </div>
        <strong>{loaded ? stats.enriched : "—"}</strong>
        <small>{loaded ? `${percentage} % der Leads` : "Wird geladen …"}</small>
      </article>,
      metricMount,
    )
    : null;

  const pipelineStep = pipelineMount
    ? createPortal(
      <div className="pipeline__step dashboard-enrichment-step">
        <span className={`pipeline__node ${stats.enriched > 0 ? "pipeline__node--done" : ""}`}>
          {stats.enriched > 0 ? "✓" : "0"}
        </span>
        <strong>{loaded ? stats.enriched : "—"}</strong>
        <small>Angereichert</small>
        <span className="pipeline__line dashboard-enrichment-line" />
      </div>,
      pipelineMount,
    )
    : null;

  return (
    <>
      <style>{`
        .metric-grid {
          grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
        }
        .dashboard-enrichment-icon {
          background: #fff4ec;
          color: #ff6817;
        }
        .pipeline {
          grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
        }
        .dashboard-enrichment-line {
          background: #f8a679;
        }
        @media (max-width: 1180px) {
          .metric-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 760px) {
          .metric-grid {
            grid-template-columns: 1fr !important;
          }
          .pipeline {
            min-width: 720px;
          }
        }
      `}</style>
      {metricCard}
      {pipelineStep}
    </>
  );
}
