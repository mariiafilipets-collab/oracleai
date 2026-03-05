/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@react-native-async-storage/async-storage": false,
    };
    config.watchOptions = {
      ...(config.watchOptions || {}),
      // Prevent watcher from touching protected Windows folders.
      ignored: ["**/System Volume Information/**", "**/$RECYCLE.BIN/**"],
    };
    config.externals.push("pino-pretty", "encoding");
    return config;
  },
};

module.exports = nextConfig;
