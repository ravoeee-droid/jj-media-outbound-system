"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LandingSegment } from "@/lib/landing-studio";
import styles from "./SegmentedVideoPlayer.module.css";

type SegmentedVideoPlayerProps = {
  segments: LandingSegment[];
  socialProfileUrl?: string | null;
  masterVideoUrl?: string | null;
  company: string;
  accentColor?: string;
  compact?: boolean;
  seekRequest?: { index: number; nonce: number };
  onPlaybackStart?: () => void;
  onProgress?: (percent: number) => void;
  onActiveSegmentChange?: (index: number) => void;
};

const VIDEO_DURATION_FALLBACK = 15;
const rates = [1, 1.25, 1.5, 2];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function formatTime(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = Math.floor(safeValue % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function SegmentedVideoPlayer({
  segments,
  socialProfileUrl = null,
  masterVideoUrl = null,
  company,
  accentColor = "#f23f7b",
  compact = false,
  seekRequest,
  onPlaybackStart,
  onProgress,
  onActiveSegmentChange,
}: SegmentedVideoPlayerProps) {
  const cleanSegments = useMemo(
    () => segments.filter((segment) => segment.type === "social" || ((segment.type === "video" || segment.type === "image") && segment.mediaUrl)),
    [segments],
  );
  const effectiveSegments = cleanSegments.length
    ? cleanSegments
    : [{ id: "social-fallback", type: "social", role: "social", label: "Instagram-Profil", duration: 4 } satisfies LandingSegment];

  const [activeIndex, setActiveIndex] = useState(0);
  const [localTime, setLocalTime] = useState(0);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rateIndex, setRateIndex] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const segmentVideoRef = useRef<HTMLVideoElement>(null);
  const masterVideoRef = useRef<HTMLVideoElement>(null);
  const startedRef = useRef(false);
  const reportedProgressRef = useRef(new Set<number>());
  const activeIndexRef = useRef(0);
  const lastSeekNonceRef = useRef<number | null>(null);

  const activeSegment = effectiveSegments[Math.min(activeIndex, effectiveSegments.length - 1)];
  const playbackRate = rates[rateIndex];
  const showTalkingHead = Boolean(masterVideoUrl && activeSegment.role !== "speaker");
  const currentSegmentDuration = activeSegment.type !== "video"
    ? clamp(activeSegment.duration ?? 4, 1, 120)
    : durations[activeSegment.id] ?? VIDEO_DURATION_FALLBACK;

  const segmentDurations = effectiveSegments.map((segment) => segment.type !== "video"
    ? clamp(segment.duration ?? 4, 1, 120)
    : durations[segment.id] ?? VIDEO_DURATION_FALLBACK);
  const segmentStarts = segmentDurations.map((_, index) => segmentDurations.slice(0, index).reduce((sum, duration) => sum + duration, 0));
  const totalDuration = segmentDurations.reduce((sum, duration) => sum + duration, 0);
  const globalTime = clamp((segmentStarts[activeIndex] ?? 0) + localTime, 0, totalDuration);
  const nextVideoUrl = effectiveSegments
    .slice(activeIndex + 1)
    .find((segment) => segment.type === "video" && segment.mediaUrl)?.mediaUrl;

  useEffect(() => {
    if (!onProgress || totalDuration <= 0) return;
    const percent = Math.min(100, Math.round((globalTime / totalDuration) * 100));
    for (const milestone of [25, 50, 75, 100]) {
      if (percent >= milestone && !reportedProgressRef.current.has(milestone)) {
        reportedProgressRef.current.add(milestone);
        onProgress(milestone);
      }
    }
  }, [globalTime, onProgress, totalDuration]);

  const reportStart = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    onPlaybackStart?.();
  }, [onPlaybackStart]);

  const applyPlayback = useCallback(async () => {
    const segmentVideo = segmentVideoRef.current;
    const masterVideo = masterVideoRef.current;
    if (!playing) {
      segmentVideo?.pause();
      masterVideo?.pause();
      return;
    }

    reportStart();
    const starts: Promise<unknown>[] = [];
    if (segmentVideo && activeSegment.type === "video") {
      segmentVideo.playbackRate = playbackRate;
      segmentVideo.muted = activeSegment.role === "proof" || muted;
      starts.push(segmentVideo.play().catch(() => undefined));
    }
    if (masterVideo && showTalkingHead) {
      masterVideo.playbackRate = playbackRate;
      masterVideo.muted = muted;
      starts.push(masterVideo.play().catch(() => undefined));
    } else {
      masterVideo?.pause();
    }
    await Promise.all(starts);
  }, [activeSegment.role, activeSegment.type, muted, playbackRate, playing, reportStart, showTalkingHead]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    onActiveSegmentChange?.(activeIndex);
  }, [activeIndex, onActiveSegmentChange]);

  useEffect(() => {
    if (activeIndex >= effectiveSegments.length) {
      setActiveIndex(0);
      setLocalTime(0);
    }
  }, [activeIndex, effectiveSegments.length]);

  useEffect(() => {
    void applyPlayback();
  }, [activeIndex, applyPlayback]);

  useEffect(() => {
    if (!playing || activeSegment.type === "video") return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = ((now - previous) / 1000) * playbackRate;
      previous = now;
      setLocalTime((current) => current + elapsed);
    }, 80);
    return () => window.clearInterval(timer);
  }, [activeSegment.type, playbackRate, playing]);

  const goToSegment = useCallback((index: number, offset = 0) => {
    const nextIndex = clamp(index, 0, effectiveSegments.length - 1);
    const nextSegment = effectiveSegments[nextIndex];
    const nextDuration = nextSegment.type !== "video"
      ? clamp(nextSegment.duration ?? 4, 1, 120)
      : durations[nextSegment.id] ?? VIDEO_DURATION_FALLBACK;
    const nextOffset = clamp(offset, 0, Math.max(0, nextDuration - 0.01));
    setActiveIndex(nextIndex);
    setLocalTime(nextOffset);
    window.requestAnimationFrame(() => {
      const video = segmentVideoRef.current;
      if (video && nextSegment.type === "video") {
        try {
          video.currentTime = nextOffset;
        } catch {
          // Metadata may still be loading; onLoadedMetadata applies the offset again.
        }
      }
    });
  }, [durations, effectiveSegments]);

  useEffect(() => {
    if (!seekRequest) return;
    if (seekRequest.nonce <= 0) return;
    if (lastSeekNonceRef.current === seekRequest.nonce) return;
    lastSeekNonceRef.current = seekRequest.nonce;
    goToSegment(seekRequest.index, 0);
    setPlaying(true);
  }, [goToSegment, seekRequest]);

  const advance = useCallback(() => {
    const current = activeIndexRef.current;
    if (current < effectiveSegments.length - 1) {
      goToSegment(current + 1, 0);
      return;
    }
    setPlaying(false);
    setLocalTime(segmentDurations[current] ?? 0);
  }, [effectiveSegments.length, goToSegment, segmentDurations]);

  useEffect(() => {
    if (activeSegment.type !== "video" && localTime >= currentSegmentDuration) advance();
  }, [activeSegment.type, advance, currentSegmentDuration, localTime]);

  function seekTo(target: number) {
    const safeTarget = clamp(target, 0, Math.max(0, totalDuration - 0.01));
    let index = effectiveSegments.length - 1;
    for (let candidate = 0; candidate < segmentStarts.length; candidate += 1) {
      if (safeTarget < segmentStarts[candidate] + segmentDurations[candidate]) {
        index = candidate;
        break;
      }
    }
    goToSegment(index, safeTarget - segmentStarts[index]);

    const master = masterVideoRef.current;
    if (master?.duration && Number.isFinite(master.duration)) {
      master.currentTime = safeTarget % master.duration;
    }
  }

  function togglePlayback() {
    if (!playing && globalTime >= totalDuration - 0.05) goToSegment(0, 0);
    setPlaying((current) => !current);
  }

  function toggleMuted() {
    setMuted((current) => !current);
  }

  async function toggleFullscreen() {
    if (!playerRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    } else {
      await playerRef.current.requestFullscreen().catch(() => undefined);
    }
  }

  return (
    <div
      ref={playerRef}
      className={`${styles.player} ${compact ? styles.compact : styles.landing} ${playing ? styles.isPlaying : ""}`}
      style={{ "--player-accent": accentColor } as React.CSSProperties}
    >
      <div className={styles.stage}>
        {activeSegment.type === "video" && activeSegment.mediaUrl ? (
          <video
            key={activeSegment.id}
            ref={segmentVideoRef}
            className={`${styles.sceneVideo} ${activeSegment.role === "proof" ? styles.proofVideo : ""}`}
            src={activeSegment.mediaUrl}
            playsInline
            preload="auto"
            muted={activeSegment.role === "proof" || muted}
            onLoadStart={() => setBuffering(true)}
            onCanPlay={() => {
              setBuffering(false);
              void applyPlayback();
            }}
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              if (Number.isFinite(duration) && duration > 0) {
                setDurations((current) => ({ ...current, [activeSegment.id]: duration }));
              }
              event.currentTarget.currentTime = clamp(localTime, 0, Math.max(0, duration - 0.01));
              void applyPlayback();
            }}
            onTimeUpdate={(event) => setLocalTime(event.currentTarget.currentTime)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onError={() => setBuffering(false)}
            onEnded={advance}
          />
        ) : activeSegment.type === "image" && activeSegment.mediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.sceneImage} src={activeSegment.mediaUrl} alt={activeSegment.label} decoding="async" />
        ) : socialProfileUrl ? (
          <div className={styles.socialViewport}>
            {/* The screenshot is intentionally served as-is so cached lead previews remain instant. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.socialImage}
              src={socialProfileUrl}
              alt={`Instagram-Profil von ${company}`}
              fetchPriority="high"
              decoding="async"
            />
          </div>
        ) : (
          <div className={styles.socialFallback}>
            <div className={styles.socialFallbackHeader}><span>IG</span><div><strong>{company}</strong><small>@instagramprofil</small></div></div>
            <div className={styles.socialFallbackStats}><span><strong>128</strong><small>Beiträge</small></span><span><strong>2.480</strong><small>Follower</small></span><span><strong>346</strong><small>Gefolgt</small></span></div>
            <div className={styles.socialFallbackBio}><strong>{company}</strong><span>Marke · Menschen · echte Geschichten</span></div>
            <div className={styles.socialFallbackGrid}>{Array.from({ length: 9 }).map((_, index) => <i key={index} />)}</div>
          </div>
        )}

        {showTalkingHead && (
          <div className={styles.talkingHead}>
            <video
              ref={masterVideoRef}
              className={styles.talkingHeadVideo}
              src={masterVideoUrl ?? undefined}
              muted={muted}
              playsInline
              preload="auto"
              loop
              onLoadedMetadata={(event) => {
                if (Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0) {
                  event.currentTarget.currentTime = globalTime % event.currentTarget.duration;
                }
                void applyPlayback();
              }}
              onCanPlay={() => void applyPlayback()}
            />
            <small>JJ-Media</small>
          </div>
        )}

        {buffering && activeSegment.type === "video" && <span className={styles.spinner} aria-label="Video wird geladen" />}
        {nextVideoUrl && <video className={styles.preload} src={nextVideoUrl} preload="auto" muted playsInline />}
        {!playing && globalTime <= 0.05 && (
          <button className={styles.startOverlay} onClick={togglePlayback} aria-label="Persönliche Analyse starten">
            <span>▶</span>
            <strong>Persönliche Analyse starten</strong>
          </button>
        )}
      </div>

      <div className={styles.controls}>
        <button onClick={togglePlayback} aria-label={playing ? "Pausieren" : "Abspielen"} className={styles.primaryControl}>
          {playing ? "Ⅱ" : "▶"}
        </button>
        <button onClick={() => seekTo(globalTime - 10)} aria-label="10 Sekunden zurück">↶<small>10</small></button>
        <button onClick={() => seekTo(globalTime + 10)} aria-label="10 Sekunden vor">↷<small>10</small></button>
        <div className={styles.timeline}>
          <input
            type="range"
            min={0}
            max={Math.max(totalDuration, 0.01)}
            step={0.05}
            value={globalTime}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label="Videoposition"
            style={{ "--progress": `${totalDuration ? (globalTime / totalDuration) * 100 : 0}%` } as React.CSSProperties}
          />
          <div className={styles.segmentMarkers}>
            {effectiveSegments.map((segment, index) => (
              <button
                key={segment.id}
                className={index === activeIndex ? styles.activeMarker : ""}
                style={{ flexGrow: segmentDurations[index] }}
                onClick={() => seekTo(segmentStarts[index])}
                aria-label={`${segment.label} abspielen`}
                title={segment.label}
              />
            ))}
          </div>
        </div>
        <span className={styles.time}>{formatTime(globalTime)} / {formatTime(totalDuration)}</span>
        <button onClick={() => setRateIndex((current) => (current + 1) % rates.length)} aria-label="Geschwindigkeit ändern" className={styles.rate}>
          {playbackRate}×
        </button>
        <button onClick={toggleMuted} aria-label={muted ? "Ton einschalten" : "Ton ausschalten"}>{muted ? "🔇" : "🔊"}</button>
        <button onClick={toggleFullscreen} aria-label="Vollbild">⛶</button>
      </div>
    </div>
  );
}
