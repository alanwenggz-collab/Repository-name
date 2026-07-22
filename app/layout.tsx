import type { Metadata } from "next";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://jsonicle-editor.liberlivegpt.chatgpt.site";
const image = `${basePath}/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Jsonable | Visual JSON Editor",
  description: "直观识别并替换 JSON 中的颜色、组合形状与图片资源。",
  icons: { icon: `${basePath}/favicon.svg`, shortcut: `${basePath}/favicon.svg` },
  openGraph: { title: "Jsonable | Visual JSON Editor", description: "看清结构，改得准确。", images: [{ url: image, width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: "Jsonable | Visual JSON Editor", description: "看清结构，改得准确。", images: [image] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
