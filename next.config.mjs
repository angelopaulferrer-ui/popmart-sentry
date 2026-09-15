/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Optimize + edge-cache Pop Mart images through our own /_next/image endpoint.
    remotePatterns: [{ protocol: "https", hostname: "**.popmart.com" }],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400, // keep optimized copies at the edge for a day
  },
};

export default nextConfig;
