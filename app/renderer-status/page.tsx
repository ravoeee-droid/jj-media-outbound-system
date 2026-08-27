import { verifyVideoRenderer } from "@/lib/video-renderer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export default async function RendererStatusPage() {
  let status: Awaited<ReturnType<typeof verifyVideoRenderer>> | null = null;
  let error = "";
  try {
    status = await verifyVideoRenderer();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Renderer nicht verfügbar.";
  }
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#07101e", color: "#fff", fontFamily: "system-ui", padding: 24 }}>
      <section style={{ width: "min(620px, 100%)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16, background: "#0d192a", padding: 32 }}>
        <p style={{ color: status?.ok ? "#4bd594" : "#ff7b5c", fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", fontSize: 12 }}>
          {status?.ok ? "Renderer online" : "Renderer Fehler"}
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 32 }}>Single-Video-Pipeline</h1>
        <p style={{ color: "#9ba9bb", lineHeight: 1.65 }}>
          {status?.ok
            ? `${status.format} · ${status.resolution} · nativer HTML5-Player`
            : error}
        </p>
      </section>
    </main>
  );
}
