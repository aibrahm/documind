import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-to-img", "canvas", "pdfjs-dist"],
};

export default nextConfig;
