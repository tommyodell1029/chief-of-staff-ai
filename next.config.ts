import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packages Next must not bundle (native code, or they load files at runtime).
  serverExternalPackages: ["better-sqlite3", "node-ical", "node-cron", "sharp", "@ffmpeg-installer/ffmpeg"],
  // Let `npm run dev` work when opened through a private Tailscale https address (see docs/tailscale-setup.md).
  allowedDevOrigins: ["**.ts.net"],
};

export default nextConfig;
