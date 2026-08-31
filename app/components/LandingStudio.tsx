"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
import SegmentedVideoPlayer from "./SegmentedVideoPlayer";
import {
  defaultLandingStudioConfig,
  LandingSegment,
  LandingStudioConfig,
  MASTER_VIDEO_ASSET_ID,
  parseLandingStudioConfig,
} from "@/lib/landing-studio";

type StudioLead = { id: string; company: string; slug: string };
type MediaAsset = {
  id: string;
  kind: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  previewUrl?: string;
};

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeMediaType(file: File) {
  const filename = file.name.toLowerCase();
  if (["video/mp4", "video/webm", "image/jpeg", "image/png", "image/webp"].includes(file.type)) return file.type;
  if (filename.endsWith(".webm")) return "video/webm";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  throw new Error(`${file.name}: Erlaubt sind MP4, WebM, JPG, PNG oder WebP.`);
}

function validateBrowserMedia(file: File, contentType: string) {
  if (contentType.startsWith("image/")) return;
  const video = document.createElement("video");
  if (!video.canPlayType(contentType)) {
    throw new Error(`${file.name}: Dieses Videoformat kann dein Browser nicht abspielen. Bitte als MP4 (H.264/AAC) oder WebM exportieren.`);
  }
}

export default function LandingStudio({ leads, notify }: { leads: StudioLead[]; notify: (message: string) => void }) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [scope, setScope] = useState("global");
  const [config, setConfig] = useState<LandingStudioConfig>(() => structuredClone(defaultLandingStudioConfig));
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState("");
  const [selectedRole, setSelectedRole] = useState<"speaker" | "proof">("proof");
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [previewSeekRequest, setPreviewSeekRequest] = useState({ index: 0, nonce: 0 });
  const videoAssets = useMemo(() => assets.filter((asset) => asset.kind === "video_asset" && asset.contentType.startsWith("video/")), [assets]);
  const imageAssets = useMemo(() => assets.filter((asset) => asset.kind === "image_asset" && asset.contentType.startsWith("image/")), [assets]);
  const mediaAssets = useMemo(() => [...videoAssets, ...imageAssets], [imageAssets, videoAssets]);
  const selectedMedia = useMemo(() => mediaAssets.find((asset) => asset.id === selectedAsset), [mediaAssets, selectedAsset]);
  const masterAsset = useMemo(() => assets.find((asset) => asset.kind === "master_video" && asset.previewUrl), [assets]);
  const previewLead = scope === "global" ? leads[0] : leads.find((lead) => lead.id === scope) ?? leads[0];
  const previewSegments = useMemo(
    () => config.segments.map((segment) => ({
      ...segment,
      mediaUrl: segment.assetId === MASTER_VIDEO_ASSET_ID
        ? masterAsset?.previewUrl
        : segment.assetId
          ? assets.find((asset) => asset.id === segment.assetId)?.previewUrl
          : undefined,
    })),
    [assets, config.segments, masterAsset],
  );

  useEffect(() => {
    Promise.all([
      fetch("/api/assets").then((response) => response.json()) as Promise<{ assets?: MediaAsset[] }>,
      fetch("/api/settings").then((response) => response.json()) as Promise<{ settings?: Record<string, string> }>,
    ]).then(([assetPayload, settingPayload]) => {
      setAssets(assetPayload.assets ?? []);
      const values = settingPayload.settings ?? {};
      setSettings(values);
      setConfig(parseLandingStudioConfig(values.landing_studio_config));
    }).catch(() => notify("Das Landingpage-Studio konnte nicht geladen werden."));
  }, [notify]);

  function loadScope(nextScope: string) {
    setScope(nextScope);
    setActivePreviewIndex(0);
    const key = nextScope === "global" ? "landing_studio_config" : `landing_studio_config:${nextScope}`;
    setConfig(parseLandingStudioConfig(settings[key] || settings.landing_studio_config));
  }

  function patch<K extends keyof LandingStudioConfig>(key: K, value: LandingStudioConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function moveSegment(index: number, direction: -1 | 1) {
    setConfig((current) => {
      const segments = [...current.segments];
      const target = index + direction;
      if (target < 0 || target >= segments.length) return current;
      [segments[index], segments[target]] = [segments[target], segments[index]];
      return { ...current, segments };
    });
  }

  function updateSegment(id: string, patchValue: Partial<LandingSegment>) {
    setConfig((current) => ({
      ...current,
      segments: current.segments.map((segment) => segment.id === id ? { ...segment, ...patchValue } : segment),
    }));
  }

  function addSocialSegment() {
    patch("segments", [...config.segments, {
      id: uid("social"),
      type: "social",
      role: "social",
      label: "Instagram-Profil",
      duration: 4,
    }]);
  }

  function addMediaSegment() {
    const asset = mediaAssets.find((item) => item.id === selectedAsset);
    if (!asset) {
      notify("Bitte zuerst ein Bild oder Video aus der Medienbibliothek auswählen.");
      return;
    }
    const isImage = asset.contentType.startsWith("image/");
    patch("segments", [...config.segments, {
      id: uid(isImage ? "image" : selectedRole),
      type: isImage ? "image" : "video",
      role: isImage ? "proof" : selectedRole,
      label: asset.filename.replace(/\.[^.]+$/, ""),
      assetId: asset.id,
      mediaUrl: asset.previewUrl,
      ...(isImage ? { duration: 5 } : {}),
    }]);
  }

  async function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const contentType = normalizeMediaType(file);
        const isImage = contentType.startsWith("image/");
        const maximumSize = isImage ? 20 * 1024 * 1024 : 80 * 1024 * 1024;
        if (file.size > maximumSize) throw new Error(`${file.name} ist größer als ${isImage ? 20 : 80} MB.`);
        validateBrowserMedia(file, contentType);
        const kind = isImage ? "image_asset" : "video_asset";
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
        const blob = await upload(`media-library/${Date.now()}-${safeName}`, file, {
          access: "private",
          handleUploadUrl: "/api/assets/upload",
          multipart: true,
          contentType,
          clientPayload: JSON.stringify({ kind, filename: file.name, contentType, size: file.size }),
          onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(((index + percentage / 100) / files.length) * 100)),
        });
        const response = await fetch("/api/assets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind,
            blobUrl: blob.url,
            pathname: blob.pathname,
            filename: file.name,
            contentType,
            size: file.size,
          }),
        });
        const payload = await response.json() as { asset?: MediaAsset; error?: string };
        if (!response.ok || !payload.asset) throw new Error(payload.error || `${file.name} konnte nicht registriert werden.`);
        setAssets((current) => [payload.asset!, ...current]);
        setSelectedAsset(payload.asset.id);
      }
      notify(`${files.length} Medium${files.length > 1 ? "en" : ""} hochgeladen und sofort in der Timeline verfügbar.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Medien-Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      event.target.value = "";
    }
  }

  async function save() {
    const key = scope === "global" ? "landing_studio_config" : `landing_studio_config:${scope}`;
    const persistableConfig: LandingStudioConfig = {
      ...config,
      segments: config.segments.map(({ mediaUrl: _mediaUrl, ...segment }) => segment),
    };
    const value = JSON.stringify(persistableConfig);
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (!response.ok) {
      notify("Die Landingpage-Vorlage konnte nicht gespeichert werden.");
      return;
    }
    setSettings((current) => ({ ...current, [key]: value }));
    notify(scope === "global" ? "Globale Landingpage-Vorlage gespeichert." : "Individuelle Lead-Vorlage gespeichert.");
  }

  return (
    <section className="workspace-page studio-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow eyebrow--dark">Premium Builder</p>
          <h2>Social-Analyse & Video Studio</h2>
          <p>Steuere Instagram-Aufnahme, Medien, Reihenfolge, Proof und Conversion-Texte. Die Vorschau nutzt denselben Player wie die echte Landingpage.</p>
        </div>
        <div className="studio-heading-actions">
          <select value={scope} onChange={(event) => loadScope(event.target.value)} aria-label="Vorlagenbereich">
            <option value="global">Standard für alle Leads</option>
            {leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.company}</option>)}
          </select>
          <button className="button button--primary" onClick={save}>Vorlage speichern</button>
        </div>
      </div>

      <div className="studio-layout">
        <div className="studio-controls">
          <article className="studio-card">
            <div className="studio-card__head"><div><small>01</small><strong>Texte & Branding</strong></div><span>Live</span></div>
            <label>Headline<input value={config.headline} onChange={(event) => patch("headline", event.target.value)} /></label>
            <label>Unterzeile<textarea rows={4} value={config.subtitle} onChange={(event) => patch("subtitle", event.target.value)} /></label>
            <div className="studio-two">
              <label>CTA-Text<input value={config.ctaLabel} onChange={(event) => patch("ctaLabel", event.target.value)} /></label>
              <label>Akzentfarbe<span className="color-field"><input type="color" value={config.accentColor} onChange={(event) => patch("accentColor", event.target.value)} /><input value={config.accentColor} onChange={(event) => patch("accentColor", event.target.value)} /></span></label>
            </div>
            <div className="panel-info"><span className="live-dot" />Kunden-Landingpages starten immer erst nach einem bewussten Play-Klick.</div>
          </article>

          <article className="studio-card">
            <div className="studio-card__head"><div><small>02</small><strong>Ablauf & Sequenzen</strong></div><span>{config.segments.length} Schritte</span></div>
            <div className="studio-timeline">
              {config.segments.map((segment, index) => (
                <div className={`studio-segment ${index === activePreviewIndex ? "studio-segment--active" : ""}`} key={segment.id}>
                  <button
                    className={`studio-segment__type studio-segment__type--${segment.role}`}
                    onClick={() => setPreviewSeekRequest((current) => ({ index, nonce: current.nonce + 1 }))}
                    aria-label={`${segment.label} in der Vorschau abspielen`}
                  >
                    {segment.type === "social" ? "▣" : segment.type === "image" ? "▧" : segment.role === "speaker" ? "●" : "★"}
                  </button>
                  <div>
                    <input value={segment.label} onChange={(event) => updateSegment(segment.id, { label: event.target.value })} aria-label="Segmentname" />
                    <small>
                      {segment.type === "social"
                        ? "Instagram-Profil + Talking Head"
                        : segment.type === "image"
                          ? "Bild + Talking Head"
                          : segment.assetId === MASTER_VIDEO_ASSET_ID
                          ? "Mastervideo – füllt die verbleibende Laufzeit"
                          : segment.role === "speaker"
                            ? "Sprechervideo mit Ton"
                            : "Proof-Video + Talking Head"}
                    </small>
                  </div>
                  {(segment.type === "social" || segment.type === "image") && (
                    <label className="duration-field">
                      <input type="number" min="1" max="120" value={segment.duration ?? 4} onChange={(event) => updateSegment(segment.id, { duration: Number(event.target.value) })} /> Sek.
                    </label>
                  )}
                  <div className="segment-actions">
                    <button onClick={() => moveSegment(index, -1)} disabled={index === 0} aria-label="Nach oben">↑</button>
                    <button onClick={() => moveSegment(index, 1)} disabled={index === config.segments.length - 1} aria-label="Nach unten">↓</button>
                    <button
                      onClick={() => patch("segments", config.segments.filter((item) => item.id !== segment.id))}
                      aria-label="Entfernen"
                      disabled={segment.assetId === MASTER_VIDEO_ASSET_ID}
                      title={segment.assetId === MASTER_VIDEO_ASSET_ID ? "Das Mastervideo ist für die Tonspur erforderlich." : undefined}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="studio-add-row">
              <button className="button button--soft" onClick={addSocialSegment}>＋ Instagram-Profil</button>
              <select value={selectedAsset} onChange={(event) => setSelectedAsset(event.target.value)}>
                <option value="">Medium auswählen …</option>
                <optgroup label="Bilder">
                  {imageAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.filename}</option>)}
                </optgroup>
                <optgroup label="Videos">
                  {videoAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.filename}</option>)}
                </optgroup>
              </select>
              <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as "speaker" | "proof")} disabled={selectedMedia?.contentType.startsWith("image/")}>
                <option value="speaker">Sprecher – Vollbild & Ton</option>
                <option value="proof">Proof – mit Talking Head</option>
              </select>
              <button className="button button--primary" onClick={addMediaSegment}>Medium einfügen</button>
            </div>
          </article>

          <article className="studio-card">
            <div className="studio-card__head"><div><small>03</small><strong>Medienbibliothek</strong></div><span>{imageAssets.length} Bilder · {videoAssets.length} Videos</span></div>
            <label className={`studio-upload ${uploading ? "is-uploading" : ""}`}>
              <input type="file" accept="video/mp4,video/webm,image/jpeg,image/png,image/webp" multiple onChange={uploadMedia} disabled={uploading} />
              <strong>{uploading ? `Upload läuft … ${uploadProgress} %` : "Bilder oder Videos hochladen"}</strong>
              <small>JPG, PNG, WebP bis 20 MB · MP4 oder WebM bis 80 MB · mehrere gleichzeitig</small>
            </label>
            <div className="media-library">
              {mediaAssets.map((asset) => {
                const isImage = asset.contentType.startsWith("image/");
                return (
                  <button className={selectedAsset === asset.id ? "is-selected" : ""} key={asset.id} onClick={() => setSelectedAsset(asset.id)}>
                    <span className="media-library__cover">
                      {isImage && asset.previewUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={asset.previewUrl} alt="" />
                        : <i>▶</i>}
                    </span>
                    <span><strong>{asset.filename}</strong><small>{Math.max(1, Math.round(asset.size / 1024 / 1024))} MB · {isImage ? "Bild" : "Video"}</small></span>
                  </button>
                );
              })}
              {!mediaAssets.length && <p>Noch keine zusätzlichen Medien. Lade Bilder, Sprecher- oder Proof-Videos hier hoch.</p>}
            </div>
          </article>
        </div>

        <aside className="studio-preview">
          <div className="studio-preview__bar">
            <span><i />Echte Live-Vorschau</span>
            {previewLead && <a href={`/v/${previewLead.slug}`} target="_blank" rel="noreferrer">Echte LP öffnen ↗</a>}
          </div>
          <SegmentedVideoPlayer
            segments={previewSegments}
            socialProfileUrl={previewLead ? `/api/media/social/${previewLead.slug}` : null}
            masterVideoUrl={masterAsset?.previewUrl}
            company={previewLead?.company || "Musterunternehmen"}
            accentColor={config.accentColor}
            compact
            seekRequest={previewSeekRequest}
            onActiveSegmentChange={setActivePreviewIndex}
          />
          <h3>{config.headline.replace("{{unternehmen}}", previewLead?.company || "Musterunternehmen")}</h3>
          <p>{config.subtitle}</p>
          <button className="studio-cta" style={{ background: config.accentColor }}>{config.ctaLabel}</button>
          <div className="studio-preview__sequence">
            {config.segments.map((segment, index) => (
              <div className={index === activePreviewIndex ? "is-active" : ""} key={segment.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{segment.label}</strong>
                <small>{segment.type === "social" || segment.type === "image" ? `${segment.duration ?? 4} Sekunden` : segment.role === "speaker" ? "Sprecher" : "Proof"}</small>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
