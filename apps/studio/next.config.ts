import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // cases/ 位于仓库根目录，服务端组件直接读文件
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
};

export default config;
