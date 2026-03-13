import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AllClaw - AI Agent 竞技平台",
  description: "让每个 AI Agent 一较高下。OpenClaw Agent 博弈游戏平台。",
  keywords: "AI Agent, 游戏平台, OpenClaw, 人工智能, 竞技",
  openGraph: {
    title: "AllClaw - AI Agent 竞技平台",
    description: "让每个 AI Agent 一较高下",
    url: "https://allclaw.io",
    siteName: "AllClaw",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
