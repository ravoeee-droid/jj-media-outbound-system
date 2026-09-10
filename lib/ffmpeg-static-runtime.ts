import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const PROXY_VERSION = "1";
const proxyPath = path.join(tmpdir(), `dg-ffmpeg-runtime-proxy-v${PROXY_VERSION}.mjs`);

const proxySource = `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const release = "b6.1.1";
const version = "6.1.1";
const hashes = {
  "linux-x64": "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa",
  "linux-arm64": "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0",
  "darwin-x64": "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
  "darwin-arm64": "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
};

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function ensureBinary() {
  const key = process.platform + "-" + process.arch;
  const expectedHash = hashes[key];
  if (!expectedHash) throw new Error("Unsupported FFmpeg platform: " + key);

  const binaryPath = path.join(tmpdir(), "dg-ffmpeg-" + version + "-" + key);
  if (existsSync(binaryPath)) {
    await chmod(binaryPath, 0o755).catch(() => undefined);
    return binaryPath;
  }

  const nonce = process.pid + "-" + Date.now();
  const gzipPath = binaryPath + ".gz-" + nonce;
  const tempPath = binaryPath + ".tmp-" + nonce;
  const sourceUrl = "https://github.com/eugeneware/ffmpeg-static/releases/download/" + release + "/ffmpeg-" + key + ".gz";

  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error("FFmpeg download failed: HTTP " + response.status);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(gzipPath));
    const actualHash = await sha256File(gzipPath);
    if (actualHash !== expectedHash) throw new Error("FFmpeg checksum mismatch");
    await pipeline(createReadStream(gzipPath), createGunzip(), createWriteStream(tempPath));
    await chmod(tempPath, 0o755);
    await rename(tempPath, binaryPath);
    return binaryPath;
  } finally {
    await Promise.all([
      rm(gzipPath, { force: true }).catch(() => undefined),
      rm(tempPath, { force: true }).catch(() => undefined),
    ]);
  }
}

try {
  const override = process.env.FFMPEG_EXECUTABLE_PATH || process.env.FFMPEG_BIN;
  const binary = override || await ensureBinary();
  const child = spawn(binary, process.argv.slice(2), { stdio: "inherit", env: process.env });
  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(126);
  });
  child.on("close", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(126);
}
`;

function runtimeProxyPath() {
  if (!existsSync(proxyPath)) {
    writeFileSync(proxyPath, proxySource, { encoding: "utf8", mode: 0o755 });
  }
  chmodSync(proxyPath, 0o755);
  return proxyPath;
}

function installedFfmpegPath() {
  const require = createRequire(import.meta.url);
  const packageName = ["ffmpeg", "static"].join("-");
  const entry = require.resolve(packageName);
  return path.join(path.dirname(entry), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

// Vercel/Linux uses a tiny runtime proxy so the ~80 MB FFmpeg binary is not
// copied into every server function/deployment. Windows local development
// keeps using the installed ffmpeg-static binary because Windows cannot
// execute the generated .mjs proxy directly.
const ffmpegBinary = process.platform === "win32" ? installedFfmpegPath() : runtimeProxyPath();

export default ffmpegBinary;
