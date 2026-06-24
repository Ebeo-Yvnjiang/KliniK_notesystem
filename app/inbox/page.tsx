import { ProblemTable } from "@/components/problem-table";
import { getProblems } from "@/lib/content";
import { getGraphNodes, isNodeEffectivelyActive } from "@/lib/graph/store";

export const metadata = { title: "待整理" };

export default function InboxPage() {
  const problems = getProblems().filter(
    (problem) =>
      problem.status === "inbox" ||
      problem.status === "partial" ||
      problem.status === "needs_analysis" ||
      problem.has_todo,
  );
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
        <p className="eyebrow">REVIEW QUEUE</p>
        <h1>待整理</h1>
        <p>包含 inbox、partial、needs_analysis 或 TODO，共 {problems.length} 张。</p>
      </section>
      <ProblemTable
        parentOptions={parentOptions}
        problems={problems}
        showFilters
      />
    </>
  );
}
