import fs from "node:fs";
import Link from "next/link";
import matter from "gray-matter";
import { notFound, redirect } from "next/navigation";
import { EditableNodeContent } from "@/components/editable-node-content";
import { MarkdownContent } from "@/components/markdown-content";
import { isEditableContentNode } from "@/lib/graph/content-access";
import { contentVersion } from "@/lib/graph/content-version";
import { parentCandidateDecision } from "@/lib/graph/node-capabilities";
import {
  getGraphEdges,
  getGraphNode,
  getGraphNodes,
  getNodeAncestors,
  getNodeChildren,
  getNodeDescendants,
  resolveContentPath,
} from "@/lib/graph/store";
import { policiesPath, rekeyMapPath } from "@/lib/graph/paths";

export const dynamic = "force-dynamic";

function nodePath(nodeId: string) {
  const node = getGraphNode(nodeId);
  if (!node) return nodeId;
  return [...getNodeAncestors(nodeId), node].map((item) => item.name).join(" / ");
}

export default async function NodePage({
  params,
}: {
  params: Promise<{ node_id: string }>;
}) {
  const { node_id: nodeId } = await params;
  if (!/^\d{8}$/.test(nodeId)) notFound();
  const node = getGraphNode(nodeId);
  if (!node) {
    const rekeyMap = JSON.parse(
      fs.readFileSync(rekeyMapPath, "utf8"),
    ) as Record<string, string>;
    if (rekeyMap[nodeId]) redirect(`/nodes/${rekeyMap[nodeId]}`);
    notFound();
  }

  const allNodes = getGraphNodes();
  const data = {
    nodes: allNodes,
    edges: getGraphEdges(),
    permissionPolicies: JSON.parse(
      fs.readFileSync(policiesPath, "utf8"),
    ),
  };
  const ancestors = getNodeAncestors(nodeId);
  const children = getNodeChildren(nodeId, {
    includeArchived: node.status === "archived",
  });
  const descendantCount = getNodeDescendants(nodeId).length;
  const incoming = data.edges.filter((edge) => edge.to_node_id === nodeId);
  const outgoing = data.edges.filter((edge) => edge.from_node_id === nodeId);
  const parentOptions = allNodes
    .map((item) => {
      const decision = parentCandidateDecision(data, item.node_id, node.node_id);
      return {
        node_id: item.node_id,
        name: item.name,
        path: nodePath(item.node_id),
        disabled: !decision.allowed,
        disabledReason: decision.reason,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));

  let source = "";
  let renderedContent = "";
  let editable = false;
  if (node.content_path) {
    const filePath = resolveContentPath(node);
    if (!filePath) notFound();
    source = fs.readFileSync(filePath, "utf8");
    const document = source.startsWith("---")
      ? matter(source)
      : { data: {}, content: source };
    renderedContent = document.content;
    editable = isEditableContentNode(node, allNodes);
  }

  return (
    <>
      <nav className="breadcrumbs" aria-label="当前位置">
        {ancestors.map((ancestor) => (
          <Link href={`/nodes/${ancestor.node_id}`} key={ancestor.node_id}>
            {ancestor.name}
          </Link>
        ))}
        <span>{node.name}</span>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">
          {node.content_type} · {node.node_id}
        </p>
        <h1>{node.name}</h1>
        <p>
          直接子节点 {children.length} 个，全部后代 {descendantCount} 个。
          {node.status === "archived" && " 当前节点已归档。"}
        </p>
        <div className="quick-links">
          <Link href={`/admin/nodes?node=${node.node_id}`}>管理此节点</Link>
        </div>
      </section>

      {node.content_path ? (
        <article>
          <div className="problem-meta">
            <span>{node.node_id}</span>
            <span>用途：{node.content_type}</span>
            <span>{node.status}</span>
            <span>父节点 {node.primary_parent_id ?? "—"}</span>
            {node.external_ids.map((externalId) => (
              <span key={externalId}>{externalId}</span>
            ))}
          </div>
          {editable ? (
            <EditableNodeContent
              currentParentId={node.primary_parent_id}
              parentOptions={parentOptions}
              renderedContent={renderedContent}
              source={source}
              target={{ kind: "node", id: node.node_id }}
              version={contentVersion(source)}
            />
          ) : (
            <>
              <p className="notice">
                此正文受节点元数据或内容所有权规则保护，当前为只读。
              </p>
              <MarkdownContent content={renderedContent} />
            </>
          )}
        </article>
      ) : (
        <p className="notice">
          当前节点没有正文；它仍可拥有子节点和关系。可在节点管理页按需创建正文。
        </p>
      )}

      {children.length > 0 && (
        <section>
          <h2>子节点</h2>
          <div className="node-child-grid">
            {children.map((child) => (
              <Link
                className={`node-child-card ${child.status === "archived" ? "archived" : ""}`}
                href={`/nodes/${child.node_id}`}
                key={child.node_id}
              >
                <span>{child.node_id}</span>
                <h3>{child.name}</h3>
                <p>用途：{child.content_type}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="node-relations-summary">
        <p>入边 {incoming.length} 条 · 出边 {outgoing.length} 条</p>
        {[...incoming, ...outgoing].map((edge) => {
          const relatedId =
            edge.from_node_id === nodeId ? edge.to_node_id : edge.from_node_id;
          const related = getGraphNode(relatedId);
          return (
            <p key={edge.edge_id}>
              {edge.relation_type}：
              <Link href={`/nodes/${relatedId}`}>
                {related?.name ?? relatedId}
              </Link>
              {related?.status === "archived" && "（已归档）"}
            </p>
          );
        })}
      </section>
    </>
  );
}
