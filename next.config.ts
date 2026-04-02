import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",                                // match the Firebase auth handler path
        destination:
          "https://appliedbas-service-report-gen.firebaseapp.com/__/auth/:path*",  // forward to Firebase first-party
      },
    ];
  },
};

export default nextConfig;
