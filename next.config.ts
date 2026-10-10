import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Mac app embeds these pages; the development badge would sit on its canvas.
  devIndicators: false,
};

export default nextConfig;
