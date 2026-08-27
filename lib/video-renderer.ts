import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { get } from "@vercel/blob";
import ffmpegBinary from "ffmpeg-static";
import { MASTER_VIDEO_ASSET_ID, type LandingSegment } from "@/lib/landing-studio";

export type VideoRenderAsset = {
  id: string;
  blobUrl: string;
  pathname: string;
  filename: string;
  contentType: string;
};

type RenderLeadVideoInput = {
  screenshot: Buffer;
  masterVideo: VideoRenderAsset;
  segments: LandingSegment[];
  assetsById: Map<string, VideoRenderAsset>;
  accentColor?: string;
  onProgress?: (progress: number) => Promise<void> | void;
};

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const HEAD_SIZE = 220;
const MAX_RENDER_SECONDS = 8 * 60;

function cleanHexColor(value?: string) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : "#f23f7b";
}

function safeDuration(value: number, fallback = 4) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, 0.25), MAX_RENDER_SECONDS);
}

function fileExtension(asset: VideoRenderAsset) {
  if (asset.contentType === "video/webm") return ".webm";
  if (asset.contentType === "video/quicktime") return ".mov";
  if (asset.contentType === "image/png") return ".png";
  if (asset.contentType === "image/webp") return ".webp";
  if (asset.contentType === "image/jpeg") return ".jpg";
  return path.extname(asset.filename) || ".mp4";
}

async function runFfmpeg(args: string[], allowFailure = false) {
  const binary = ffmpegBinary;
  if (!binary) throw new Error("Der Video-Renderer ist auf diesem Server nicht installiert.");
  await chmod(binary, 0o755).catch(() => undefined);
  return new Promise<string>((resolve, reject) => {
    const child: ChildProcess = spawn(binary, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, FFREPORT: "" },
    });
    let diagnostics = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      diagnostics = `${diagnostics}${chunk}`.slice(-180_000);
    });
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code === 0 || allowFailure) {
        resolve(diagnostics);
        return;
      }
      const meaningful = diagnostics
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-8)
        .join(" ");
      reject(new Error(`FFmpeg konnte das Video nicht rendern.${meaningful ? ` ${meaningful}` : ""}`));
    });
  });
}

export async function verifyVideoRenderer() {
  await runFfmpeg(["-hide_banner", "-version"]);
  const workDirectory = await mkdtemp(path.join(tmpdir(), "jj-media-smoke-"));
  try {
    const masterPath = path.join(workDirectory, "master.mp4");
    const screenshotPath = path.join(workDirectory, "social-profile.ppm");
    const socialOutput = path.join(workDirectory, "social-profile-segment.mp4");
    const imageOutput = path.join(workDirectory, "image-segment.mp4");
    const speakerOutput = path.join(workDirectory, "speaker-segment.mp4");

    await runFfmpeg([
      "-y",
      "-f", "lavfi",
      "-i", "testsrc2=size=640x480:rate=30",
      "-f", "lavfi",
      "-i", "sine=frequency=880:sample_rate=48000",
      "-t", "1.2",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-shortest",
      masterPath,
    ]);
    const ppmHeader = Buffer.from("P6\n1280 1600\n255\n");
    const ppmPixels = Buffer.alloc(1280 * 1600 * 3, 28);
    for (let index = 0; index < ppmPixels.length; index += 3) {
      ppmPixels[index] = 20;
      ppmPixels[index + 1] = 42;
      ppmPixels[index + 2] = 65;
    }
    await writeFile(screenshotPath, Buffer.concat([ppmHeader, ppmPixels]));
    await renderSocialProfileSegment({ screenshotPath, masterPath, outputPath: socialOutput, offset: 0, duration: 0.7, accentColor: "#f23f7b" });
    await renderImageSegment({ imagePath: screenshotPath, masterPath, outputPath: imageOutput, offset: 0.2, duration: 0.5, accentColor: "#f23f7b" });
    await renderSpeakerSegment({ sourcePath: masterPath, outputPath: speakerOutput, offset: 0.7, duration: 0.45 });
    const [socialBuffer, imageBuffer, speakerBuffer] = await Promise.all([readFile(socialOutput), readFile(imageOutput), readFile(speakerOutput)]);
    if (socialBuffer.byteLength < 10_000 || imageBuffer.byteLength < 10_000 || speakerBuffer.byteLength < 10_000) throw new Error("Der Renderer-Smoke-Test hat keine vollständigen Segmente erzeugt.");
    return {
      ok: true,
      smokeTest: true,
      socialProfileSegmentBytes: socialBuffer.byteLength,
      imageSegmentBytes: imageBuffer.byteLength,
      speakerSegmentBytes: speakerBuffer.byteLength,
      format: "MP4 (H.264/AAC)",
      resolution: `${WIDTH}x${HEIGHT}`,
    };
  } finally {
    await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function probeMedia(filePath: string) {
  const diagnostics = await runFfmpeg(["-hide_banner", "-i", filePath], true);
  const match = diagnostics.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error("Die Laufzeit eines Videos konnte nicht gelesen werden.");
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return {
    duration: safeDuration(duration, 1),
    hasAudio: /\bAudio:\s/.test(diagnostics),
  };
}

async function downloadPrivateAsset(asset: VideoRenderAsset, destination: string) {
  const result = await get(asset.blobUrl || asset.pathname, { access: "private", useCache: false });
  if (!result?.stream) throw new Error(`${asset.filename} konnte nicht aus dem Medienspeicher geladen werden.`);
  await pipeline(
    Readable.fromWeb(result.stream as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(destination),
  );
}

function videoEncodingArgs() {
  return [
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
  ];
}

async function renderSocialProfileSegment(input: {
  screenshotPath: string;
  masterPath: string;
  outputPath: string;
  offset: number;
  duration: number;
  accentColor: string;
}) {
  const duration = safeDuration(input.duration);
  const color = cleanHexColor(input.accentColor).replace("#", "0x");
  const filter = [
    `[0:v]scale=w=${WIDTH}:h=-2:flags=lanczos,crop=w=${WIDTH}:h=${HEIGHT}:x=0:y='min(t*90,ih-oh)',setsar=1[bg]`,
    `[1:v]scale=w=${HEAD_SIZE}:h=${HEAD_SIZE}:force_original_aspect_ratio=increase:flags=lanczos,crop=w=${HEAD_SIZE}:h=${HEAD_SIZE},setsar=1[head]`,
    `color=c=${color}:s=${HEAD_SIZE + 8}x${HEAD_SIZE + 8}:r=${FPS}:d=${duration.toFixed(3)}[ring]`,
    `[bg][ring]overlay=W-w-44:H-h-34[withring]`,
    `[withring][head]overlay=W-w-48:H-h-38:format=auto[v]`,
  ].join(";");
  await runFfmpeg([
    "-y",
    "-loop", "1",
    "-framerate", String(FPS),
    "-i", input.screenshotPath,
    "-ss", input.offset.toFixed(3),
    "-t", duration.toFixed(3),
    "-i", input.masterPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "1:a:0",
    "-t", duration.toFixed(3),
    ...videoEncodingArgs(),
    input.outputPath,
  ]);
}

async function renderImageSegment(input: {
  imagePath: string;
  masterPath: string;
  outputPath: string;
  offset: number;
  duration: number;
  accentColor: string;
}) {
  const duration = safeDuration(input.duration, 5);
  const color = cleanHexColor(input.accentColor).replace("#", "0x");
  const filter = [
    `color=c=0x07101d:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${duration.toFixed(3)}[canvas]`,
    `[0:v]scale=w=${WIDTH}:h=${HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1[image]`,
    `[canvas][image]overlay=(W-w)/2:(H-h)/2[bg]`,
    `[1:v]scale=w=${HEAD_SIZE}:h=${HEAD_SIZE}:force_original_aspect_ratio=increase:flags=lanczos,crop=w=${HEAD_SIZE}:h=${HEAD_SIZE},setsar=1[head]`,
    `color=c=${color}:s=${HEAD_SIZE + 8}x${HEAD_SIZE + 8}:r=${FPS}:d=${duration.toFixed(3)}[ring]`,
    `[bg][ring]overlay=W-w-44:H-h-34[withring]`,
    `[withring][head]overlay=W-w-48:H-h-38:format=auto[v]`,
  ].join(";");
  await runFfmpeg([
    "-y",
    "-loop", "1",
    "-framerate", String(FPS),
    "-i", input.imagePath,
    "-ss", input.offset.toFixed(3),
    "-t", duration.toFixed(3),
    "-i", input.masterPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "1:a:0",
    "-t", duration.toFixed(3),
    ...videoEncodingArgs(),
    input.outputPath,
  ]);
}

async function renderProofSegment(input: {
  proofPath: string;
  masterPath: string;
  outputPath: string;
  offset: number;
  duration: number;
  accentColor: string;
}) {
  const duration = safeDuration(input.duration);
  const color = cleanHexColor(input.accentColor).replace("#", "0x");
  const filter = [
    `[0:v]scale=w=${WIDTH}:h=${HEIGHT}:flags=lanczos,setsar=1[bg]`,
    `[1:v]scale=w=${HEAD_SIZE}:h=${HEAD_SIZE}:force_original_aspect_ratio=increase:flags=lanczos,crop=w=${HEAD_SIZE}:h=${HEAD_SIZE},setsar=1[head]`,
    `color=c=${color}:s=${HEAD_SIZE + 8}x${HEAD_SIZE + 8}:r=${FPS}:d=${duration.toFixed(3)}[ring]`,
    `[bg][ring]overlay=W-w-44:H-h-34[withring]`,
    `[withring][head]overlay=W-w-48:H-h-38:format=auto[v]`,
  ].join(";");
  await runFfmpeg([
    "-y",
    "-i", input.proofPath,
    "-ss", input.offset.toFixed(3),
    "-t", duration.toFixed(3),
    "-i", input.masterPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "1:a:0",
    "-t", duration.toFixed(3),
    ...videoEncodingArgs(),
    input.outputPath,
  ]);
}

async function renderSpeakerSegment(input: {
  sourcePath: string;
  outputPath: string;
  offset?: number;
  duration: number;
}) {
  const duration = safeDuration(input.duration);
  await runFfmpeg([
    "-y",
    ...(input.offset ? ["-ss", input.offset.toFixed(3)] : []),
    "-t", duration.toFixed(3),
    "-i", input.sourcePath,
    "-vf",
    `scale=w=${WIDTH}:h=${HEIGHT}:flags=lanczos,setsar=1`,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-t", duration.toFixed(3),
    ...videoEncodingArgs(),
    input.outputPath,
  ]);
}

export async function renderLeadVideo(input: RenderLeadVideoInput) {
  const workDirectory = await mkdtemp(path.join(tmpdir(), "jj-media-render-"));
  try {
    const screenshotPath = path.join(workDirectory, "social-profile.webp");
    const masterPath = path.join(workDirectory, `master${fileExtension(input.masterVideo)}`);
    await Promise.all([
      writeFile(screenshotPath, input.screenshot),
      downloadPrivateAsset(input.masterVideo, masterPath),
    ]);
    const master = await probeMedia(masterPath);
    if (!master.hasAudio) {
      throw new Error("Das Mastervideo hat keine erkennbare Tonspur. Bitte als MP4 mit H.264-Video und AAC-Ton hochladen.");
    }
    if (master.duration > MAX_RENDER_SECONDS) {
      throw new Error("Das Mastervideo ist länger als 8 Minuten. Bitte eine kürzere Outbound-Version hochladen.");
    }

    const downloadedAssets = new Map<string, { path: string; duration: number; hasAudio: boolean; kind: "image" | "video" }>();
    const referencedAssets = Array.from(new Set(
      input.segments
        .map((segment) => segment.assetId)
        .filter((id): id is string => Boolean(id && id !== MASTER_VIDEO_ASSET_ID)),
    ));
    for (const assetId of referencedAssets) {
      const asset = input.assetsById.get(assetId);
      if (!asset) throw new Error("Ein Medium aus der Studio-Sequenz wurde nicht gefunden.");
      const assetPath = path.join(workDirectory, `${asset.id}${fileExtension(asset)}`);
      await downloadPrivateAsset(asset, assetPath);
      if (asset.contentType.startsWith("image/")) {
        downloadedAssets.set(assetId, { path: assetPath, duration: 0, hasAudio: false, kind: "image" });
      } else {
        downloadedAssets.set(assetId, { path: assetPath, ...(await probeMedia(assetPath)), kind: "video" });
      }
    }

    const requestedSegments = input.segments.length
      ? input.segments
      : [{ id: "social-intro", type: "social", role: "social", label: "Instagram-Profil", duration: 7 } satisfies LandingSegment];
    const hasMasterScene = requestedSegments.some((segment) => segment.assetId === MASTER_VIDEO_ASSET_ID);
    const segments = hasMasterScene
      ? requestedSegments
      : [...requestedSegments, {
        id: "master-finale",
        type: "video",
        role: "speaker",
        label: "JJ-Media Mastervideo",
        assetId: MASTER_VIDEO_ASSET_ID,
      } satisfies LandingSegment];

    const outputs: string[] = [];
    let masterOffset = 0;
    for (const segment of segments) {
      if (masterOffset >= master.duration - 0.2 && segment.role !== "speaker") break;
      const outputPath = path.join(workDirectory, `segment-${String(outputs.length).padStart(2, "0")}.mp4`);

      if (segment.type === "social") {
        const duration = Math.min(safeDuration(segment.duration ?? 6), master.duration - masterOffset);
        if (duration < 0.25) continue;
        await renderSocialProfileSegment({
          screenshotPath,
          masterPath,
          outputPath,
          offset: masterOffset,
          duration,
          accentColor: cleanHexColor(input.accentColor),
        });
        masterOffset += duration;
      } else if (segment.type === "image") {
        const media = segment.assetId ? downloadedAssets.get(segment.assetId) : undefined;
        if (!media || media.kind !== "image") throw new Error("Das ausgewählte Bild wurde nicht gefunden oder hat ein ungültiges Format.");
        const duration = Math.min(safeDuration(segment.duration ?? 5), master.duration - masterOffset);
        if (duration < 0.25) continue;
        await renderImageSegment({
          imagePath: media.path,
          masterPath,
          outputPath,
          offset: masterOffset,
          duration,
          accentColor: cleanHexColor(input.accentColor),
        });
        masterOffset += duration;
      } else if (segment.assetId === MASTER_VIDEO_ASSET_ID) {
        const duration = master.duration - masterOffset;
        if (duration < 0.25) continue;
        await renderSpeakerSegment({
          sourcePath: masterPath,
          outputPath,
          offset: masterOffset,
          duration,
        });
        masterOffset += duration;
      } else {
        const media = segment.assetId ? downloadedAssets.get(segment.assetId) : undefined;
        if (!media || media.kind !== "video") continue;
        if (segment.role === "proof") {
          const duration = Math.min(media.duration, master.duration - masterOffset);
          if (duration < 0.25) continue;
          await renderProofSegment({
            proofPath: media.path,
            masterPath,
            outputPath,
            offset: masterOffset,
            duration,
            accentColor: cleanHexColor(input.accentColor),
          });
          masterOffset += duration;
        } else {
          if (!media.hasAudio) {
            throw new Error("Ein Sprecher-Video hat keine Tonspur. Nutze für stumme Clips den Typ „Proof“.");
          }
          await renderSpeakerSegment({
            sourcePath: media.path,
            outputPath,
            duration: media.duration,
          });
        }
      }

      outputs.push(outputPath);
      await input.onProgress?.(45 + Math.round((outputs.length / segments.length) * 40));
    }

    if (!outputs.length) throw new Error("Die Studio-Sequenz enthält keine renderbaren Schritte.");
    const outputPath = path.join(workDirectory, "lead-video.mp4");
    if (outputs.length === 1) {
      await runFfmpeg([
        "-y",
        "-i", outputs[0],
        "-c", "copy",
        "-movflags", "+faststart",
        outputPath,
      ]);
    } else {
      const concatPath = path.join(workDirectory, "segments.txt");
      await writeFile(concatPath, outputs.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"));
      await runFfmpeg([
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concatPath,
        "-c", "copy",
        "-movflags", "+faststart",
        outputPath,
      ]);
    }
    await input.onProgress?.(92);
    const buffer = await readFile(outputPath);
    if (buffer.byteLength < 25_000) throw new Error("Der Renderer hat keine vollständige MP4-Datei erzeugt.");
    return {
      buffer,
      duration: masterOffset,
      contentType: "video/mp4" as const,
    };
  } finally {
    await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
