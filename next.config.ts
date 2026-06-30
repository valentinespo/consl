import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Allow larger image uploads via Server Actions (default body limit is 1MB).
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
