import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "@sparticuz/chromium-min", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/generate": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/renderer-health": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/renderer-status": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
