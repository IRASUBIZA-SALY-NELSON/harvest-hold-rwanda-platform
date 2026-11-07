import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The portal is all live, signed-in data: nothing is cached or prerendered.
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  // Dev server only: lets other devices on the Wi-Fi open the portal (scripts are blocked otherwise).
  allowedDevOrigins: ['192.168.0.115'],
  // Docker: a self-contained server in .next/standalone (see Dockerfile).
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
