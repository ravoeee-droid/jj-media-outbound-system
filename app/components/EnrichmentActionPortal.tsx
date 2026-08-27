"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function findLeadActions() {
  const headings = Array.from(document.querySelectorAll<HTMLElement>(".workspace-heading"));
  const leadHeading = headings.find((heading) =>
    heading.querySelector("h2")?.textContent?.trim() === "Alle Leads",
  );
  return leadHeading?.querySelector<HTMLElement>(".workspace-actions") ?? null;
}

export default function EnrichmentActionPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const syncTarget = () => setTarget(findLeadActions());
    syncTarget();

    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  if (!target) return null;

  return createPortal(
    <a
      className="button button--soft"
      href="/dashboard/enrichment"
      style={{ order: -1, textDecoration: "none" }}
    >
      ✦ Leads enrichen
    </a>,
    target,
  );
}
