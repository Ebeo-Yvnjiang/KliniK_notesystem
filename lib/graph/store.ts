import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  PermissionPolicy,
} from "./types.ts";
import {
  edgesPath,
  idStatePath,
  legacyRouteMapPath,
  nodesPath,
  policiesPath,
  projectRoot,
  rekeyMapPath,
} from "./paths.ts";

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function readGraphData(): GraphData {
  return {
    nodes: readJson<GraphNode[]>(nodesPath),
    edges: readJson<GraphEdge[]>(edgesPath),
    permissionPolicies: readJson<PermissionPolicy[]>(policiesPath),
  };
}

export function getGraphNodes() {
  return readGraphData().nodes;
}

export function getGraphNode(nodeId: string) {
  return getGraphNodes().find((node) => node.node_id === nodeId) ?? null;
}

export function getGraphEdges() {
  return readGraphData().edges;
}

export function getGraphVersion() {
  const hash = crypto.createHash("sha256");
  for (const filePath of [
    nodesPath,
    edgesPath,
    policiesPath,
    idStatePath,
    legacyRouteMapPath,
    rekeyMapPath,
  ]) {
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function isNodeEffectivelyActive(
  nodeId: string,
  nodes = getGraphNodes(),
) {
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const visited = new Set<string>();
  let current = byId.get(nodeId);
  while (current) {
    if (visited.has(current.node_id)) {
      throw new Error(`检查归档状态时检测到循环：${current.node_id}`);
    }
    visited.add(current.node_id);
    if (current.status !== "active") return false;
    current = current.primary_parent_id
      ? byId.get(current.primary_parent_id)
      : undefined;
  }
  return true;
}

export function getNodeChildren(
  parentId: string,
  options?: { includeArchived?: boolean },
) {
  return getGraphNodes()
    .filter(
      (node) =>
        node.primary_parent_id === parentId &&
        (options?.includeArchived ||
          (node.status === "active" && isNodeEffectivelyActive(node.node_id))),
    )
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order ||
        left.node_id.localeCompare(right.node_id),
    );
}

export function getNodeAncestors(nodeId: string) {
  const nodes = getGraphNodes();
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const ancestors: GraphNode[] = [];
  const visited = new Set<string>();
  let current = byId.get(nodeId);
  while (current?.primary_parent_id) {
    if (visited.has(current.node_id)) {
      throw new Error(`主要归属链存在循环：${current.node_id}`);
    }
    visited.add(current.node_id);
    const parent = byId.get(current.primary_parent_id);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }
  return ancestors;
}

export function getNodeDescendants(nodeId: string) {
  const nodes = getGraphNodes();
  const result: GraphNode[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const parentId = queue.shift()!;
    if (visited.has(parentId)) {
      throw new Error(`遍历后代时检测到循环：${parentId}`);
    }
    visited.add(parentId);
    const children = nodes.filter((node) => node.primary_parent_id === parentId);
    result.push(...children);
    queue.push(...children.map((node) => node.node_id));
  }
  return result;
}

export function resolveContentPath(node: GraphNode) {
  if (!node.content_path) return null;
  const resolved = path.resolve(projectRoot, node.content_path);
  const privateRoot = path.resolve(projectRoot, "content", "private");
  if (
    !resolved.startsWith(`${privateRoot}${path.sep}`) ||
    ![".md", ".mdx"].includes(path.extname(resolved))
  ) {
    throw new Error(`节点 ${node.node_id} 的内容路径不在 private 白名单中。`);
  }
  return resolved;
}

export function getEffectivePermissionPolicy(nodeId: string) {
  const data = readGraphData();
  const byId = new Map(data.nodes.map((node) => [node.node_id, node]));
  const policyById = new Map(
    data.permissionPolicies.map((policy) => [
      policy.permission_policy_id,
      policy,
    ]),
  );
  const visited = new Set<string>();
  let current = byId.get(nodeId);
  while (current) {
    if (visited.has(current.node_id)) {
      throw new Error(`权限继承链存在循环：${current.node_id}`);
    }
    visited.add(current.node_id);
    const policy = policyById.get(current.permission_policy_id);
    if (!policy) return null;
    if (!policy.inherit_from_parent || !current.primary_parent_id) return policy;
    current = byId.get(current.primary_parent_id);
  }
  return null;
}
