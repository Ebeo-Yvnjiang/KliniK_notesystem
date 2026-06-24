import { ProblemTable } from "@/components/problem-table";
import { getProblems } from "@/lib/content";
import { getGraphNodes, isNodeEffectivelyActive } from "@/lib/graph/store";

export const metadata = { title: "题目锚点索引" };

export default function ProblemsPage() {
  const problems = getProblems();
  const graphNodes = getGraphNodes();
  const parentOptions = [
    { id: "全部", name: "全部" },
    ...graphNodes
      .filter(
        (node) =>
          ["module", "system_placeholder"].includes(node.content_type) &&
          isNodeEffectivelyActive(node.node_id, graphNodes) &&
          node.status === "active",
      )
      .map((node) => ({ id: node.node_id, name: node.name })),
  ];
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">INDEX</p>
        <h1>题目锚点索引</h1>
        <p>共 {problems.length} 张卡，包含外部题号和考试来源锚点。</p>
        <div className="quick-links">
          <a href="/review/low-boundary">低边界信度</a>
          <a href="/review/low-classification">低分类信度</a>
          <a href="/review/needs-ai">待 AI 补解析</a>
          <a href="/review/empty">空卡</a>
          <a href="/review/unassigned">未归属片段</a>
          <a href="/review/classification-corrections">人工分类修正日志</a>
        </div>
      </section>
      <ProblemTable
        parentOptions={parentOptions}
        problems={problems}
        showFilters
        validNodeIds={graphNodes.map((node) => node.node_id)}
      />
    </>
  );
}
