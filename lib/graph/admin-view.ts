import type { GraphNode } from "./types.ts";

export function contentTargetNodeId(node: GraphNode, nodes: GraphNode[]) {
  if (node.content_path) return node.node_id;
  return (
    nodes.find(
      (child) =>
        child.primary_parent_id === node.node_id &&
        child.content_type === "module_summary" &&
        child.content_path &&
        child.status === "active",
    )?.node_id ?? null
  );
}
