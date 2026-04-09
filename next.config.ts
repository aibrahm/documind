import type { NextConfig } from "next";

// We no longer use `pdf-parse` or `pdf-to-img` at runtime — PDF text
// extraction goes through `unpdf` (serverless-native), which handles its
// own bundling internally. Keeping `canvas` external in case any future
// dep needs it. pdfjs-dist is no longer externalized because unpdf manages
// its own pdfjs build.
const nextConfig: NextConfig = {
  serverExternalPackages: ["canvas"],
};

export default nextConfig;
