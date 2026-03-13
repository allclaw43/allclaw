import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:3001/api/:path*",
      },
      {
        source: "/ws",
        destination: "http://127.0.0.1:3001/ws",
      },
      {
        source: "/health",
        destination: "http://127.0.0.1:3001/health",
      },
    ];
  },
};

export default nextConfig;
