"use client";

import { useRef, useState } from "react";
import styles from "./RenderedVideoPlayer.module.css";

type RenderedVideoPlayerProps = {
  videoUrl: string;
  posterUrl?: string | null;
  company: string;
  accentColor?: string;
  onPlaybackStart?: () => void;
  onProgress?: (percent: number) => void;
};

export default function RenderedVideoPlayer({
  videoUrl,
  posterUrl,
  company,
  accentColor = "#f23f7b",
  onPlaybackStart,
  onProgress,
}: RenderedVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedRef = useRef(false);
  const milestonesRef = useRef(new Set<number>());
  const [hasStarted, setHasStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  function reportStart() {
    setHasStarted(true);
    if (startedRef.current) return;
    startedRef.current = true;
    onPlaybackStart?.();
  }

  function reportProgress() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const percent = Math.min(100, Math.round((video.currentTime / video.duration) * 100));
    for (const milestone of [25, 50, 75, 100]) {
      if (percent >= milestone && !milestonesRef.current.has(milestone)) {
        milestonesRef.current.add(milestone);
        onProgress?.(milestone);
      }
    }
  }

  async function startPlayback() {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
    } catch {
      setFailed(true);
    }
  }

  return (
    <div
      className={styles.frame}
      style={{ "--render-accent": accentColor } as React.CSSProperties}
    >
      <video
        ref={videoRef}
        className={styles.video}
        controls
        controlsList="nodownload"
        disablePictureInPicture={false}
        playsInline
        preload="metadata"
        poster={posterUrl || undefined}
        aria-label={`Persönliche Video-Analyse für ${company}`}
        onPlay={reportStart}
        onTimeUpdate={reportProgress}
        onEnded={() => {
          onProgress?.(100);
          milestonesRef.current.add(100);
        }}
        onError={() => setFailed(true)}
      >
        <source src={videoUrl} type="video/mp4" />
        Ihr Browser unterstützt diesen Videoplayer nicht.
      </video>

      {!hasStarted && !failed && (
        <button className={styles.start} type="button" onClick={() => void startPlayback()}>
          <span aria-hidden="true">▶</span>
          <strong>Persönliche Analyse abspielen</strong>
        </button>
      )}
      {failed && (
        <div className={styles.status}>
          Das Video konnte in diesem Browser nicht geladen werden. Bitte laden Sie die Seite einmal neu.
        </div>
      )}
    </div>
  );
}
