/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared contracts and cloud packages are consumed as workspace source
  // and transpiled by Next rather than pre-built.
  transpilePackages: ["@virtualhems/contracts", "@virtualhems/cloud"],
};

export default nextConfig;
