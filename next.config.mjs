/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "prod-apac-r2.popmart.com" },
      { protocol: "https", hostname: "prod-server-r2.popmart.com" },
      { protocol: "https", hostname: "cdn-apac-static.popmart.com" },
      { protocol: "https", hostname: "cdn-global.popmart.com" },
    ],
  },
};

export default nextConfig;
