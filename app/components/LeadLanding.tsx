"use client";

import { useEffect, useMemo, useState } from "react";
import Brand from "./Brand";
import RenderedVideoPlayer from "./RenderedVideoPlayer";
import { defaultLandingStudioConfig, LandingStudioConfig } from "@/lib/landing-studio";
import styles from "./LeadLanding.module.css";

type LeadLandingProps = { company: string; slug: string; initialVideoUrl?: string | null };

const steps = [
  { number: "01", title: "Profil auf den Punkt bringen", text: "In wenigen Sekunden muss klar werden, für wen Ihr Angebot gedacht ist und warum man Ihnen folgen sollte." },
  { number: "02", title: "Content mit Wiedererkennung", text: "Starke Formate verbinden Persönlichkeit, Nutzen und visuelle Klarheit statt austauschbarer Einzelposts." },
  { number: "03", title: "Reichweite in Anfragen verwandeln", text: "Klare Handlungsaufforderungen und ein einfacher Funnel führen Interessenten vom Profil zum qualifizierten Gespräch." },
];

export default function LeadLanding({ company, slug, initialVideoUrl = null }: LeadLandingProps) {
  const [viewTracked, setViewTracked] = useState(false);
  const [scrollVideoUrl, setScrollVideoUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(initialVideoUrl);
  const [studioConfig, setStudioConfig] = useState<LandingStudioConfig>(defaultLandingStudioConfig);
  const [calendarEmbedUrl, setCalendarEmbedUrl] = useState<string | null>(null);
  const shortCompany = useMemo(() => company.replace(/\b(GmbH|AG|KG|OHG)\b/gi, "").trim(), [company]);

  function visitorId() {
    try {
      const key = "jj_media_visitor_id";
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      const created = crypto.randomUUID();
      window.localStorage.setItem(key, created);
      return created;
    } catch {
      return undefined;
    }
  }

  useEffect(() => {
    fetch(`/api/landing/${slug}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("No personalized assets")))
      .then((payload: {
        scrollVideoUrl?: string | null;
        posterUrl?: string | null;
        renderedVideoUrl?: string | null;
        calendarEmbedUrl?: string | null;
        studioConfig?: LandingStudioConfig;
      }) => {
        setScrollVideoUrl(payload.scrollVideoUrl || null);
        setPosterUrl(payload.posterUrl || null);
        setRenderedVideoUrl((current) => current || payload.renderedVideoUrl || null);
        setCalendarEmbedUrl(payload.calendarEmbedUrl || null);
        if (payload.studioConfig) setStudioConfig(payload.studioConfig);
      })
      .catch(() => undefined);

    const timer = window.setTimeout(() => {
      setViewTracked(true);
      fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, company, type: "view", visitorId: visitorId() }),
      }).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [company, slug]);

  function trackPlayback() {
    fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, company, type: "play", visitorId: visitorId() }),
    }).catch(() => undefined);
  }

  function trackProgress(percent: number) {
    fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, company, type: "progress", value: percent, visitorId: visitorId() }),
    }).catch(() => undefined);
  }

  return (
    <main className="lead-page" data-lead={slug} data-view-tracked={viewTracked}>
      <header className="lead-header">
        <Brand />
        <div className="lead-header__right"><span className="live-dot" />Persönlich für Sie vorbereitet</div>
      </header>

      <section className="lead-hero">
        <div className="personal-label">
          <span className="personal-label__bars" aria-hidden="true"><i /><i /><i /></span>
          Persönliche Social-Media-Analyse für <strong>{shortCompany}</strong>
        </div>

        <div className="lead-grid">
          <div className="video-column">
            {renderedVideoUrl ? (
              <RenderedVideoPlayer
                videoUrl={renderedVideoUrl}
                posterUrl={posterUrl || scrollVideoUrl}
                company={shortCompany}
                accentColor={studioConfig.accentColor}
                onPlaybackStart={trackPlayback}
                onProgress={trackProgress}
              />
            ) : (
              <div className={styles.renderPending}>
                {(posterUrl || scrollVideoUrl) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={posterUrl || scrollVideoUrl || undefined} alt={`Instagram-Profil von ${shortCompany}`} />
                )}
                <div>
                  <span>Video wird vorbereitet</span>
                  <strong>Die persönliche Analyse ist gleich verfügbar.</strong>
                </div>
              </div>
            )}
            <h1 style={{ "--landing-accent": studioConfig.accentColor } as React.CSSProperties}>
              {studioConfig.headline.split("{{unternehmen}}").map((part, index, parts) => (
                <span className="headline-fragment" key={`${part}-${index}`}>
                  {part}{index < parts.length - 1 && <em>{shortCompany}</em>}
                </span>
              ))}
            </h1>
            <p className="lead-subtitle">{studioConfig.subtitle}</p>
          </div>

          <aside className="calendar-card">
            {calendarEmbedUrl ? (
              <div className="calendar-embed-wrap">
                <div className="calendar-card__heading">
                  <span className="calendar-card__accent" />
                  <h2>Wann passt es Ihnen?</h2>
                  <p>Wählen Sie direkt einen freien Termin.</p>
                </div>
                <iframe src={calendarEmbedUrl} title="Termin buchen" loading="lazy" />
                <div className="calendar-trust"><span className="shield-icon">✓</span>Unverbindlich <i /> 15 Minuten <i /> Klarer nächster Schritt</div>
              </div>
            ) : (
              <div className="booking-success">
                <span className="booking-success__check">!</span>
                <p className="eyebrow eyebrow--orange">Terminbuchung</p>
                <h2>Kalender wird gerade eingerichtet.</h2>
                <p>Bitte antworten Sie direkt auf die persönliche Nachricht. Das JJ-Media Team meldet sich mit passenden Terminvorschlägen.</p>
              </div>
            )}
          </aside>
        </div>
      </section>

      <section className="lead-levers">
        <div className="lead-levers__heading">
          <p className="eyebrow eyebrow--orange">So sieht der Weg aus</p>
          <h2>Kein Agentur-Blabla. Ein nachvollziehbarer Prozess.</h2>
        </div>
        <div className="lever-grid">
          {steps.map((step) => (
            <article key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>
          ))}
        </div>
      </section>
    </main>
  );
}
