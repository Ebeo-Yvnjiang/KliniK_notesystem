import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { isEdgeId, isNodeId } from "./id-allocator.ts";
import { projectRoot } from "./paths.ts";
import type {
  GraphData,
  GraphIssue,
  GraphNode,
  RelationType,
} from "./types.ts";

const allowedRelations = new Set<RelationType>([
  "cites",
  "related_to",
  "supports",
  "derived_from",
  "shortcut_to",
  "supersedes",
]);
const acyclicRelations = new Set<RelationType>([
  "derived_from",
  "supersedes",
]);

function detectDirectedCycle(
  nodeIds: string[],
  links: Map<string, string[]>,
) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(nodeId: string): string[] | null {
    if (visiting.has(nodeId)) return [nodeId];
    if (visited.has(nodeId)) return null;
    visiting.add(nodeId);
    for (const next of links.get(nodeId) ?? []) {
      const cycle = visit(next);
      if (cycle) return [nodeId, ...cycle];
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  }
  for (const nodeId of nodeIds) {
    const cycle = visit(nodeId);
    if (cycle) return cycle;
  }
  return null;
}

export function validateGraphData(
  data: GraphData,
  options?: { checkContentFiles?: boolean },
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const policyIds = new Set(
    data.permissionPolicies.map((policy) => policy.permission_policy_id),
  );
  const contentOwners = new Map<string, string>();
  const siblingNames = new Map<string, Map<string, string>>();
  const siblingIdentifiers = new Map<string, Map<string, string>>();

  for (const node of data.nodes) {
    if (!isNodeId(node.node_id)) {
      issues.push({
        severity: "error",
        code: "invalid_node_id",
        message: `节点 ID 必须是8位数字：${node.node_id}`,
        node_id: node.node_id,
      });
    }
    if (nodeIds.has(node.node_id)) {
      issues.push({
        severity: "error",
        code: "duplicate_node_id",
        message: `节点 ID 重复：${node.node_id}`,
        node_id: node.node_id,
      });
    }
    nodeIds.add(node.node_id);
    if (node.primary_parent_id === node.node_id) {
      issues.push({
        severity: "error",
        code: "self_parent",
        message: "节点不能成为自己的父节点。",
        node_id: node.node_id,
      });
    }
    if (!policyIds.has(node.permission_policy_id)) {
      issues.push({
        severity: "error",
        code: "missing_permission_policy",
        message: `权限策略不存在：${node.permission_policy_id}`,
        node_id: node.node_id,
      });
    }
    if (node.content_path) {
      const normalized = node.content_path.replaceAll("\\", "/");
      const existingOwner = contentOwners.get(normalized);
      if (existingOwner) {
        issues.push({
          severity: "error",
          code: "duplicate_content_owner",
          message: `内容文件被多个节点拥有：${existingOwner}、${node.node_id}`,
          node_id: node.node_id,
          file_path: normalized,
        });
      }
      contentOwners.set(normalized, node.node_id);
      const absolute = path.resolve(projectRoot, normalized);
      if ((options?.checkContentFiles ?? true) && !fs.existsSync(absolute)) {
        issues.push({
          severity: "error",
          code: "missing_content_file",
          message: "节点内容文件不存在。",
          node_id: node.node_id,
          file_path: normalized,
        });
      } else if (
        fs.existsSync(absolute) &&
        [".md", ".mdx"].includes(path.extname(absolute))
      ) {
        const source = fs.readFileSync(absolute, "utf8");
        if (source.startsWith("---")) {
          const document = matter(source);
          if (
            document.data.node_id &&
            String(document.data.node_id) !== node.node_id
          ) {
            issues.push({
              severity: "error",
              code: "content_node_id_mismatch",
              message: `内容 frontmatter node_id=${document.data.node_id} 与节点不一致。`,
              node_id: node.node_id,
              file_path: normalized,
            });
          }
        }
      }
    }
    if (node.status === "active") {
      const parentKey = node.primary_parent_id ?? "__root__";
      const names = siblingNames.get(parentKey) ?? new Map<string, string>();
      const normalizedName = node.name.trim().toLocaleLowerCase("zh-CN");
      const existing = names.get(normalizedName);
      if (existing) {
        issues.push({
          severity: "error",
          code: "duplicate_sibling_name",
          message: `同一父节点下名称重复：${node.name}（${existing}、${node.node_id}）`,
          node_id: node.node_id,
        });
      }
      names.set(normalizedName, node.node_id);
      siblingNames.set(parentKey, names);
      const identifiers =
        siblingIdentifiers.get(parentKey) ?? new Map<string, string>();
      for (const value of [node.name, ...node.aliases]) {
        const normalized = value.trim().toLocaleLowerCase("zh-CN");
        if (!normalized) continue;
        const owner = identifiers.get(normalized);
        if (owner && owner !== node.node_id) {
          issues.push({
            severity: "error",
            code: "ambiguous_sibling_alias",
            message: `同一父节点下名称或别名无法消解：${value}（${owner}、${node.node_id}）`,
            node_id: node.node_id,
          });
        }
        identifiers.set(normalized, node.node_id);
      }
      siblingIdentifiers.set(parentKey, identifiers);
    }
  }

  for (const node of data.nodes) {
    if (node.primary_parent_id && !nodeIds.has(node.primary_parent_id)) {
      issues.push({
        severity: "error",
        code: "missing_parent",
        message: `主要父节点不存在：${node.primary_parent_id}`,
        node_id: node.node_id,
      });
    }
    if (!node.primary_parent_id && node.content_type !== "knowledge_base") {
      issues.push({
        severity: "error",
        code: "orphan_node",
        message: "只有知识库根节点可以没有主要父节点。",
        node_id: node.node_id,
      });
    }
  }

  const parentLinks = new Map<string, string[]>();
  for (const node of data.nodes) {
    if (!node.primary_parent_id) continue;
    const links = parentLinks.get(node.node_id) ?? [];
    links.push(node.primary_parent_id);
    parentLinks.set(node.node_id, links);
  }
  const parentCycle = detectDirectedCycle([...nodeIds], parentLinks);
  if (parentCycle) {
    issues.push({
      severity: "error",
      code: "primary_parent_cycle",
      message: `主要归属存在循环：${parentCycle.join(" -> ")}`,
    });
  }

  for (const edge of data.edges) {
    if (!isEdgeId(edge.edge_id)) {
      issues.push({
        severity: "error",
        code: "invalid_edge_id",
        message: `边 ID 必须是10位数字：${edge.edge_id}`,
        edge_id: edge.edge_id,
      });
    }
    if (edgeIds.has(edge.edge_id)) {
      issues.push({
        severity: "error",
        code: "duplicate_edge_id",
        message: `边 ID 重复：${edge.edge_id}`,
        edge_id: edge.edge_id,
      });
    }
    edgeIds.add(edge.edge_id);
    if (!nodeIds.has(edge.from_node_id) || !nodeIds.has(edge.to_node_id)) {
      issues.push({
        severity: "error",
        code: "dangling_edge",
        message: "关系边引用了不存在的节点。",
        edge_id: edge.edge_id,
      });
    }
    if (!allowedRelations.has(edge.relation_type)) {
      issues.push({
        severity: "error",
        code: "invalid_relation_type",
        message: `未知关系类型：${edge.relation_type}`,
        edge_id: edge.edge_id,
      });
    }
  }

  for (const relationType of acyclicRelations) {
    const links = new Map<string, string[]>();
    for (const edge of data.edges.filter(
      (item) => item.relation_type === relationType,
    )) {
      const targets = links.get(edge.from_node_id) ?? [];
      targets.push(edge.to_node_id);
      links.set(edge.from_node_id, targets);
    }
    const cycle = detectDirectedCycle([...nodeIds], links);
    if (cycle) {
      issues.push({
        severity: "error",
        code: "acyclic_relation_cycle",
        message: `${relationType} 关系存在循环：${cycle.join(" -> ")}`,
      });
    }
  }

  return issues;
}

export function assertGraphValid(
  data: GraphData,
  options?: { checkContentFiles?: boolean },
) {
  const errors = validateGraphData(data, options).filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length) {
    throw new Error(
      `图数据校验失败：${errors
        .slice(0, 5)
        .map((issue) => issue.message)
        .join("；")}`,
    );
  }
}
