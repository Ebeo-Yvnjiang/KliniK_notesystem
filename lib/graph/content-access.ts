import path from "node:path";
import type { GraphNode } from "./types.ts";
import {
  getGraphNodes,
  isNodeEffectivelyActive,
  resolveContentPath,
} from "./store.ts";

function uniquelyOwned(node: GraphNode, nodes: GraphNode[]) {
  if (!node.content_path) return false;
  const normalized = node.content_path.replaceAll("\\", "/");
  return (
    nodes.filter(
      (item) => item.content_path?.replaceAll("\\", "/") === normalized,
    ).length === 1
  );
}

export function isEditableContentNode(
  node: GraphNode,
  nodes = getGraphNodes(),
) {
  if (
    !node.content_path ||
    node.metadata?.immutable_archive ||
    node.metadata?.web_editable === false ||
    !uniquelyOwned(node, nodes)
  ) {
    return false;
  }
  const normalized = node.content_path.replaceAll("\\", "/");
  return [
    "content/private/raw-notes/",
    "content/private/subjects/physics/problem-notes/",
    "content/private/subjects/physics/modules/",
    "content/private/subjects/physics/nodes/",
    "content/private/subjects/physics/review-pages/",
  ].some((prefix) => normalized.startsWith(prefix));
}

export function isSearchableContentNode(
  node: GraphNode,
  nodes = getGraphNodes(),
  includeArchived = false,
) {
  if (
    !node.content_path ||
    !uniquelyOwned(node, nodes) ||
    (!includeArchived && !isNodeEffectivelyActive(node.node_id, nodes))
  ) {
    return false;
  }
  try {
    const filePath = resolveContentPath(node);
    return Boolean(
      filePath && [".md", ".mdx"].includes(path.extname(filePath)),
    );
  } catch {
    return false;
  }
}

export function editableContentNodes(nodes = getGraphNodes()) {
  return nodes.filter((node) => isEditableContentNode(node, nodes));
}

export function searchableContentNodes(
  nodes = getGraphNodes(),
  includeArchived = false,
) {
  return nodes.filter((node) =>
    isSearchableContentNode(node, nodes, includeArchived),
  );
}
