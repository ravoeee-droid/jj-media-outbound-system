export type LandingSegment = {
  id: string;
  type: "social" | "video" | "image";
  role: "social" | "speaker" | "proof";
  label: string;
  assetId?: string;
  duration?: number;
  mediaUrl?: string;
};

export type LandingStudioConfig = {
  version: 1;
  headline: string;
  subtitle: string;
  ctaLabel: string;
  accentColor: string;
  autoplaySpeaker: boolean;
  segments: LandingSegment[];
};

export const MASTER_VIDEO_ASSET_ID = "__master__";

export const defaultLandingStudioConfig: LandingStudioConfig = {
  version: 1,
  headline: "3 Social-Media-Hebel für {{unternehmen}}",
  subtitle: "Ich habe mir Ihr Instagram-Profil angesehen und drei konkrete Stellen gefunden, mit denen Sie schneller Vertrauen, Reichweite und qualifizierte Anfragen aufbauen können.",
  ctaLabel: "15 Minuten Potenzial-Call",
  accentColor: "#f23f7b",
  autoplaySpeaker: false,
  segments: [
    { id: "social-intro", type: "social", role: "social", label: "Instagram-Profil", duration: 7 },
    { id: "master-video", type: "video", role: "speaker", label: "JJ-Media Mastervideo", assetId: MASTER_VIDEO_ASSET_ID },
  ],
};

type LegacyLandingSegment = Omit<Partial<LandingSegment>, "type" | "role"> & {
  type?: LandingSegment["type"] | "website";
  role?: LandingSegment["role"] | "website";
};

function normalizeSegment(segment: LegacyLandingSegment, index: number): LandingSegment | null {
  if (!segment || !["social", "website", "video", "image"].includes(String(segment.type))) return null;
  const type = segment.type === "website" ? "social" : segment.type as LandingSegment["type"];
  const role = segment.role === "website" || type === "social"
    ? "social"
    : segment.role === "speaker"
      ? "speaker"
      : "proof";
  return {
    id: segment.id || `${type}-${index}`,
    type,
    role,
    label: segment.label || (type === "social" ? "Instagram-Profil" : type === "image" ? "Bild" : role === "speaker" ? "Sprecher" : "Proof"),
    ...(segment.assetId ? { assetId: segment.assetId } : {}),
    ...(segment.duration ? { duration: segment.duration } : {}),
    ...(segment.mediaUrl ? { mediaUrl: segment.mediaUrl } : {}),
  };
}

export function parseLandingStudioConfig(value?: string | null): LandingStudioConfig {
  if (!value) return structuredClone(defaultLandingStudioConfig);
  try {
    const parsed = JSON.parse(value) as Partial<LandingStudioConfig> & { segments?: LegacyLandingSegment[] };
    const parsedSegments = Array.isArray(parsed.segments) && parsed.segments.length
      ? parsed.segments.map(normalizeSegment).filter((segment): segment is LandingSegment => Boolean(segment))
      : structuredClone(defaultLandingStudioConfig.segments);
    const segments = parsedSegments.some((segment) => segment.assetId === MASTER_VIDEO_ASSET_ID)
      ? parsedSegments
      : [...parsedSegments, structuredClone(defaultLandingStudioConfig.segments[1])];
    return {
      ...defaultLandingStudioConfig,
      ...parsed,
      version: 1,
      autoplaySpeaker: false,
      segments,
    };
  } catch {
    return structuredClone(defaultLandingStudioConfig);
  }
}
