import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit ships its own font data files — keep it out of the bundler.
  serverExternalPackages: ["pdfkit"],
  experimental: {
    // Allow larger image uploads via Server Actions (default body limit is 1MB).
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
