import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The Get help feature moved from /dashboard/get-help to /dashboard/help.
      // Keep the old path working permanently so bookmarks and any links that
      // shipped earlier still land in the right place.
      {
        source: '/dashboard/get-help/:path*',
        destination: '/dashboard/help/:path*',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
