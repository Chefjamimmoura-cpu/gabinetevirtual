import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdf-parse'],
  async redirects() {
    return [
      {
        source: '/laia',
        destination: '/alia',
        permanent: true,
      },
      {
        source: '/laia/:path*',
        destination: '/alia/:path*',
        permanent: true,
      },
      {
        source: '/api/laia/:path*',
        destination: '/api/alia/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
