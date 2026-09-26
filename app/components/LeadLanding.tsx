"use client";

import { useEffect, useMemo, useState } from "react";
import Brand from "./Brand";
import RenderedVideoPlayer from "./RenderedVideoPlayer";
import { defaultLandingStudioConfig, LandingStudioConfig } from "@/lib/landing-studio";
import styles from "./LeadLanding.module.css";

type LeadLandingProps = { company: string; slug: string; initialVideoUrl?: string | null };

const steps = [
  { number: "01", title: "Profil schärfen", text: "In Sekunden muss klar werden, für wen Ihr Angebot gedacht ist und warum man Ihnen vertrauen sollte." },
  { number: "02", title: "Content mit Wiedererkennung", text: "Formate, die Persönlichkeit, Nutzen und einen klaren roten Faden verbinden." },
  { number: "03", title: "Reichweite in Gespräche verwandeln", text: "Klare nächste Schritte führen Interessenten vom Profil direkt in ein qualifiziertes Gespräch." },
];

const outcomes = [
  "3 konkrete Hebel statt allgemeiner Agentur-Tipps",
  "Persönliche Analyse auf Basis Ihres aktuellen Auftritts",
  "Direkter nächster Schritt ohne langen Verkaufsprozess",
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

  function trackCta() {
    fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, company, type: "cta_click", visitorId: visitorId() }),
    }).catch(() => undefined);
    document.getElementById("termin")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

        <div className="lead-hero-copy">
          <span>Nur für {shortCompany}</span>
          <h1>Ich habe Ihren Auftritt geprüft – hier sind die <em>3 stärksten Hebel</em>, die ich zuerst angehen würde.</h1>
          <p>Kurzes persönliches Video. Konkrete Beobachtungen. Wenn es relevant ist, können Sie direkt daneben einen 15-Minuten-Termin wählen.</p>
          <div className="lead-proof-row"><span>✓ Persönlich vorbereitet</span><span>✓ Kein Pitch-Marathon</span><span>✓ 15 Minuten</span></div>
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
            <div className="video-conversion-strip">
              <div><small>PERSONALISIERT</small><strong>{shortCompany}</strong></div>
              <button type="button" onClick={trackCta}>Termin auswählen →</button>
            </div>
            <h2 className="landing-video-headline" style={{ "--landing-accent": studioConfig.accentColor } as React.CSSProperties}>
              {studioConfig.headline.split("{{unternehmen}}").map((part, index, parts) => (
                <span className="headline-fragment" key={`${part}-${index}`}>
                  {part}{index < parts.length - 1 && <em>{shortCompany}</em>}
                </span>
              ))}
            </h2>
            <p className="lead-subtitle">{studioConfig.subtitle}</p>
            <div className="landing-outcomes">{outcomes.map((item) => <span key={item}>✓ {item}</span>)}</div>
          </div>

          <aside className="calendar-card" id="termin">
            {calendarEmbedUrl ? (
              <div className="calendar-embed-wrap">
                <div className="calendar-card__heading">
                  <span className="calendar-card__accent" />
                  <small className="calendar-eyebrow">NÄCHSTER SCHRITT</small>
                  <h2>Wenn die Analyse relevant ist: Wann passen 15 Minuten?</h2>
                  <p>Kein Vorbereitungstermin, kein Verpflichtungsgefühl – wir schauen nur, ob und wie sich die Hebel sinnvoll umsetzen lassen.</p>
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
          <p className="eyebrow eyebrow--orange">Was Sie aus dem Video mitnehmen</p>
          <h2>Drei konkrete Hebel, die Sie intern sofort prüfen können – auch ohne Zusammenarbeit mit uns.</h2>
        </div>
        <div className="lever-grid">
          {steps.map((step) => (
            <article key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>
          ))}
        </div>
      </section>

      <section className="lead-final-cta">
        <div><small>PERSÖNLICH FÜR {shortCompany.toUpperCase()}</small><h2>Wenn mindestens ein Hebel relevant war, klären wir den sinnvollsten nächsten Schritt in 15 Minuten.</h2><p>Kein langer Pitch. Wir schauen gemeinsam auf Ausgangslage, Priorität und Umsetzbarkeit.</p></div>
        <button type="button" onClick={trackCta}>Freien Termin auswählen →</button>
      </section>

      <button className="lead-mobile-cta" type="button" onClick={trackCta}>15-Minuten-Termin wählen →</button>
    </main>
  );
}
