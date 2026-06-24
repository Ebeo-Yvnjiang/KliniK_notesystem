import Link from "next/link";
import { SearchHighlight } from "@/components/search-highlight";
import { searchGraphContent } from "@/lib/content-search";

export const dynamic = "force-dynamic";
export const metadata = { title: "全文搜索" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  let results: ReturnType<typeof searchGraphContent> = [];
  let error = "";
  if (q.trim()) {
    try {
      results = searchGraphContent(q);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "搜索失败。";
    }
  }
  return (
    <>
      <section className="page-heading backend-heading">
        <p className="eyebrow">PRIVATE CONTENT SEARCH</p>
        <h1>全文搜索</h1>
        <p>只搜索图系统登记的有效内容，不读取项目文档、配置、备份或审计日志。</p>
      </section>
      <form className="global-search-form" method="get">
        <label>
          原话或关键词
          <input
            autoFocus
            defaultValue={q}
            name="q"
            placeholder="例如：这种斜面具体计算"
            type="search"
          />
        </label>
        <button type="submit">搜索</button>
      </form>
      {!q.trim() && <p className="notice">输入原话或关键词开始搜索。</p>}
      {error && <p className="notice">搜索失败：{error}</p>}
      {q.trim() && !error && (
        <p className="result-count">找到 {results.length} 条结果。</p>
      )}
      <div className="search-results">
        {results.map((result) => (
          <Link
            className="search-result-card"
            href={`/nodes/${result.node_id}`}
            key={result.node_id}
          >
            <header>
              <h2>{result.name}</h2>
              <span>{result.content_type}</span>
            </header>
            <p className="search-result-path">{result.path}</p>
            <p>
              <SearchHighlight
                length={result.match_length}
                start={result.match_start}
                text={result.excerpt}
              />
            </p>
          </Link>
        ))}
      </div>
      {q.trim() && !error && results.length === 0 && (
        <p className="notice">没有找到匹配内容。可以尝试缩短原句。</p>
      )}
    </>
  );
}
