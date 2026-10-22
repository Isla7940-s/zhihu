import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crashlab Studio",
  description: "事故视频解析 · 三维重建 · 自动成片",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
