import Link from "next/link";
import {
  getGraphNodes,
  getNodeDescendants,
} from "@/lib/graph/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "物理" };

export default function PhysicsPage() {
  const nodes = getGraphNodes();
  const physics = nodes.find(
    (node) => node.content_type === "subject" && node.name === "物理",
  );
  if (!physics) return <p className="notice">物理根节点不存在。</p>;
  const containers = nodes
    .filter(
      (node) =>
        node.primary_parent_id === physics.node_id &&
        ["module", "system_placeholder"].includes(node.content_type) &&
        node.status === "active",
    )
    .sort((left, right) => left.sort_order - right.sort_order);
  const totalProblems = nodes.filter((node) =>
    ["problem_note", "unassigned_fragments"].includes(node.content_type),
  ).length;

  return (
    <>
      <section className="hero compact">
        <p className="eyebrow">PHYSICS · {physics.node_id}</p>
        <h1>{physics.name}</h1>
        <p>内容由稳定节点ID和主要归属关系组织，显示名称可以独立修改。</p>
        <div className="quick-links">
          <Link href="/problems">全部题目索引</Link>
          <Link href={`/nodes/${physics.node_id}`}>完整节点视图</Link>
          <Link href="/admin/nodes">节点管理</Link>
        </div>
      </section>
      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">PRIMARY CHILD CONTAINERS</p>
            <h2>主要分类容器</h2>
          </div>
          <p>{totalProblems} 张题目卡</p>
        </div>
        <div className="module-grid">
          {containers.map((node) => {
            const descendants = getNodeDescendants(node.node_id);
            const problemCount = descendants.filter((child) =>
              ["problem_note", "unassigned_fragments"].includes(
                child.content_type,
              ),
            ).length;
            return (
              <Link
                className="module-card"
                href={`/nodes/${node.node_id}`}
                key={node.node_id}
              >
                <p className="eyebrow">{node.node_id}</p>
                <h3>{node.name}</h3>
                <dl>
                  <div>
                    <dt>全部后代题目</dt>
                    <dd>{problemCount}</dd>
                  </div>
                  <div>
                    <dt>节点类型</dt>
                    <dd>{node.content_type}</dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}
