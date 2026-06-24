import type {
  GraphData,
  GraphNode,
  PermissionAction,
  PermissionPolicy,
} from "./types.ts";

function effectivePolicy(
  data: GraphData,
  nodeId: string,
): PermissionPolicy | null {
  const byId = new Map(data.nodes.map((node) => [node.node_id, node]));
  const policies = new Map(
    data.permissionPolicies.map((policy) => [
      policy.permission_policy_id,
      policy,
    ]),
  );
  const visited = new Set<string>();
  let current = byId.get(nodeId);
  while (current) {
    if (visited.has(current.node_id)) return null;
    visited.add(current.node_id);
    const policy = policies.get(current.permission_policy_id);
    if (!policy) return null;
    if (!policy.inherit_from_parent || !current.primary_parent_id) {
      return policy;
    }
    current = byId.get(current.primary_parent_id);
  }
  return null;
}

export function localAdminCan(
  data: GraphData,
  nodeId: string,
  action: PermissionAction,
) {
  return Boolean(
    effectivePolicy(data, nodeId)?.grants.local_admin?.includes(action),
  );
}

function isDescendant(
  nodes: GraphNode[],
  possibleDescendantId: string,
  ancestorId: string,
) {
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const visited = new Set<string>();
  let current = byId.get(possibleDescendantId);
  while (current?.primary_parent_id) {
    if (visited.has(current.node_id)) return true;
    visited.add(current.node_id);
    if (current.primary_parent_id === ancestorId) return true;
    current = byId.get(current.primary_parent_id);
  }
  return false;
}

export function parentCandidateDecision(
  data: GraphData,
  candidateId: string,
  movingNodeId?: string | null,
): { allowed: boolean; reason: string } {
  const candidate = data.nodes.find((node) => node.node_id === candidateId);
  if (!candidate) return { allowed: false, reason: "节点不存在或已经失效" };
  if (candidate.status !== "active") {
    return { allowed: false, reason: "节点已经归档" };
  }
  if (!localAdminCan(data, candidate.node_id, "create_child")) {
    return { allowed: false, reason: "没有在该节点下创建子节点的权限" };
  }
  if (movingNodeId) {
    if (candidate.node_id === movingNodeId) {
      return { allowed: false, reason: "不能选择自身" };
    }
    if (isDescendant(data.nodes, candidate.node_id, movingNodeId)) {
      return { allowed: false, reason: "选择后会形成循环" };
    }
  }
  return { allowed: true, reason: "" };
}
