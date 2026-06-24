import { GraphAdminPanel } from "@/components/graph-admin-panel";
import { readGraphAuditEvents } from "@/lib/graph/audit";
import { contentTargetNodeId } from "@/lib/graph/admin-view";
import { localAdminCan } from "@/lib/graph/node-capabilities";
import { listGraphBackups } from "@/lib/graph/backups";
import {
  getEffectivePermissionPolicy,
  getGraphVersion,
  getNodeDescendants,
  readGraphData,
} from "@/lib/graph/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "节点管理" };

export default async function AdminNodesPage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string }>;
}) {
  const { node: selectedNodeId = "" } = await searchParams;
  const graphData = readGraphData();
  const nodes = graphData.nodes;
  const edges = graphData.edges;
  const audit = readGraphAuditEvents();
  const backups = await listGraphBackups();
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const adminNodes = nodes.map((node) => ({
    node_id: node.node_id,
    name: node.name,
    node_kind: node.node_kind,
    content_type: node.content_type,
    primary_parent_id: node.primary_parent_id,
    parent_name: node.primary_parent_id
      ? byId.get(node.primary_parent_id)?.name ?? "缺失"
      : "",
    status: node.status,
    sort_order: node.sort_order,
    direct_children: nodes.filter(
      (child) => child.primary_parent_id === node.node_id,
    ).length,
    descendants: getNodeDescendants(node.node_id).length,
    incoming_edges: edges.filter((edge) => edge.to_node_id === node.node_id)
      .length,
    outgoing_edges: edges.filter((edge) => edge.from_node_id === node.node_id)
      .length,
    permission_policy_id: node.permission_policy_id,
    effective_permission_policy_id:
      getEffectivePermissionPolicy(node.node_id)?.permission_policy_id ??
      "missing",
    can_create_child: localAdminCan(
      graphData,
      node.node_id,
      "create_child",
    ),
    content_path: node.content_path,
    updated_at: node.updated_at,
    metadata: node.metadata ?? {},
    content_target_node_id: contentTargetNodeId(node, nodes),
  }));

  return (
    <>
      <section className="page-heading backend-heading">
        <p className="eyebrow">PRIVATE GRAPH ADMIN</p>
        <h1>节点管理</h1>
        <p>
          所有危险操作均先预览，再确认提交；提交前自动备份并执行图完整性检查。
        </p>
      </section>
      <GraphAdminPanel
        edges={edges}
        nodes={adminNodes}
        auditEvents={audit.events
          .filter((event) => !event.test_event && event.active !== false)
          .slice(-20)
          .reverse()}
        selectedNodeId={selectedNodeId}
        initialGraphVersion={getGraphVersion()}
        backups={backups}
      />
    </>
  );
}
