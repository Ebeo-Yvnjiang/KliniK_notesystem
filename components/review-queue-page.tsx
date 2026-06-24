import { ProblemTable } from "@/components/problem-table";
import type { ProblemIndexItem } from "@/lib/types";
import { getGraphNodes, isNodeEffectivelyActive } from "@/lib/graph/store";

export function ReviewQueuePage({
  eyebrow,
  title,
  description,
  problems,
}: {
  eyebrow: string;
  title: string;
  description: string;
  problems: ProblemIndexItem[];
}) {
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
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>
          {description}，共 {problems.length} 张。
        </p>
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
