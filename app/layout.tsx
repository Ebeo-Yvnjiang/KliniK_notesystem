import type { Metadata } from "next";
import Link from "next/link";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "笔记系统",
    template: "%s · 笔记系统",
  },
  description: "仅供本地查看的个人学习资料。",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            笔记系统
          </Link>
          <nav>
            <Link href="/physics">物理</Link>
            <Link href="/problems">题目索引</Link>
            <Link href="/search">全文搜索</Link>
            <Link href="/inbox">待整理</Link>
            <Link href="/review/needs-ai">待 AI 补解析</Link>
            <Link href="/review/classification-corrections">分类修正</Link>
            <Link href="/admin/nodes">节点管理</Link>
            <Link href="/admin/classification-trial">阶段B分类试运行</Link>
            <Link href="/raw">原始笔记</Link>
          </nav>
        </header>
        <div className="private-banner">
          PRIVATE · 仅供本地复习，不作为公开教学材料
        </div>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
