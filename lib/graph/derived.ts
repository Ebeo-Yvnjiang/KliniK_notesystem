import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  moduleIndexPath,
  legacyRouteMapPath,
  problemIndexPath,
  projectRoot,
} from "./paths.ts";
import type { GraphData, GraphNode } from "./types.ts";
import { isNodeEffectivelyActive } from "./store.ts";

async function writeAtomic(filePath: string, content: string) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  await fs.writeFile(tempPath, content, "utf8");
  try {
    await fs.rename(tempPath, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(tempPath, filePath);
  }
}

async function readExistingProblemIndex() {
  try {
    return JSON.parse(await fs.readFile(problemIndexPath, "utf8")) as Record<
      string,
      unknown
    >[];
  } catch {
    return [];
  }
}

function problemNodes(data: GraphData) {
  return data.nodes.filter(
    (node) =>
      ["problem_note", "unassigned_fragments"].includes(node.content_type) &&
      Boolean(node.content_path) &&
      isNodeEffectivelyActive(node.node_id, data.nodes),
  );
}

function descendants(nodes: GraphNode[], nodeId: string) {
  const result: GraphNode[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) throw new Error(`统计后代时检测到循环：${current}`);
    visited.add(current);
    const children = nodes.filter((node) => node.primary_parent_id === current);
    result.push(...children);
    queue.push(...children.map((node) => node.node_id));
  }
  return result;
}

export async function rebuildDerivedIndexes(data: GraphData) {
  const byId = new Map(data.nodes.map((node) => [node.node_id, node]));
  const existing = await readExistingProblemIndex();
  const existingByNode = new Map(
    existing
      .filter((item) => typeof item.node_id === "string")
      .map((item) => [String(item.node_id), item]),
  );
  const existingByLegacyId = new Map(
    existing.map((item) => [String(item.id), item]),
  );
  const problems: Record<string, unknown>[] = [];

  for (const node of problemNodes(data).sort((left, right) =>
    left.node_id.localeCompare(right.node_id),
  )) {
    if (!node.content_path) throw new Error(`题目节点缺少内容路径：${node.node_id}`);
    const filePath = path.resolve(projectRoot, node.content_path);
    const source = await fs.readFile(filePath, "utf8");
    const document = matter(source);
    const legacyId = String(
      document.data.id ?? node.metadata?.legacy_problem_id ?? node.node_id,
    );
    const previous =
      existingByNode.get(node.node_id) ?? existingByLegacyId.get(legacyId) ?? {};
    const parent = node.primary_parent_id
      ? byId.get(node.primary_parent_id)
      : undefined;
    problems.push({
      ...previous,
      id: legacyId,
      node_id: node.node_id,
      primary_parent_id: node.primary_parent_id,
      anchor_type: String(
        document.data.anchor_type ?? node.metadata?.anchor_type ?? "unknown_source",
      ),
      anchor_text: String(document.data.anchor_text ?? node.name),
      module: parent?.name ?? String(document.data.module ?? ""),
      submodule: String(document.data.submodule ?? "TODO"),
      knowledge_points: Array.isArray(document.data.knowledge_points)
        ? document.data.knowledge_points
        : ["TODO"],
      error_type: Array.isArray(document.data.error_type)
        ? document.data.error_type
        : ["TODO"],
      status: String(document.data.status ?? "inbox"),
      analysis_state: String(
        document.data.analysis_state ?? "original_note_available",
      ),
      needs_ai_analysis: Boolean(document.data.needs_ai_analysis),
      has_original_analysis: Boolean(document.data.has_original_analysis),
      review_priority: String(document.data.review_priority ?? "TODO"),
      boundary_confidence: String(
        document.data.boundary_confidence ?? "low",
      ),
      classification_confidence: String(
        document.data.classification_confidence ?? "low",
      ),
      classification_status: String(
        document.data.classification_status ?? "",
      ),
      content_type: String(document.data.content_type ?? node.content_type),
      file_path: node.content_path,
      has_todo: source.includes("TODO"),
      worth_public_rewrite: Boolean(document.data.worth_public_rewrite),
    });
  }

  const classificationContainers = data.nodes
    .filter(
      (node) =>
        ["module", "system_placeholder"].includes(node.content_type) &&
        isNodeEffectivelyActive(node.node_id, data.nodes) &&
        node.status === "active",
    )
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order ||
        left.node_id.localeCompare(right.node_id),
    );

  const modules = classificationContainers.map((node, index) => {
    const directProblemNodes = problemNodes(data).filter(
      (problem) => problem.primary_parent_id === node.node_id,
    );
    const descendantIds = new Set(
      descendants(data.nodes, node.node_id).map((child) => child.node_id),
    );
    const allProblemNodes = problemNodes(data).filter((problem) =>
      descendantIds.has(problem.node_id),
    );
    const summary = data.nodes.find(
      (child) =>
        child.primary_parent_id === node.node_id &&
        child.content_type === "module_summary" &&
        isNodeEffectivelyActive(child.node_id, data.nodes),
    );
    const slug = String(node.metadata?.slug ?? node.node_id);
    return {
      node_id: node.node_id,
      summary_node_id: summary?.node_id ?? "",
      name: node.name,
      slug,
      order: index + 1,
      problemCount: directProblemNodes.length,
      recursiveProblemCount: allProblemNodes.length,
      todoCount: problems.filter(
        (problem) =>
          problem.primary_parent_id === node.node_id && problem.has_todo,
      ).length,
      filePath: summary?.content_path ?? "",
      status: node.status,
      system_placeholder: Boolean(node.metadata?.system_placeholder),
    };
  });

  await writeAtomic(
    problemIndexPath,
    `${JSON.stringify(problems, null, 2)}\n`,
  );
  await writeAtomic(moduleIndexPath, `${JSON.stringify(modules, null, 2)}\n`);
  const legacyRouteMap = {
    generated_at: new Date().toISOString(),
    modules: Object.fromEntries(
      classificationContainers
        .filter((node) => typeof node.metadata?.slug === "string")
        .map((node) => {
          const summary = data.nodes.find(
            (child) =>
              child.primary_parent_id === node.node_id &&
              child.content_type === "module_summary",
          );
          return [
            String(node.metadata!.slug),
            {
              node_id: node.node_id,
              summary_node_id: summary?.node_id ?? "",
            },
          ];
        }),
    ),
    problems: Object.fromEntries(
      data.nodes
        .filter((node) =>
          ["problem_note", "unassigned_fragments"].includes(node.content_type),
        )
        .map((node) => [
        String(node.metadata?.legacy_problem_id ?? node.node_id),
        node.node_id,
        ]),
    ),
    raw:
      data.nodes.find((node) => node.content_type === "raw_note")?.node_id ?? "",
    physics:
      data.nodes.find((node) => node.content_type === "subject")?.node_id ?? "",
    root:
      data.nodes.find((node) => node.content_type === "knowledge_base")
        ?.node_id ?? "",
  };
  await writeAtomic(
    legacyRouteMapPath,
    `${JSON.stringify(legacyRouteMap, null, 2)}\n`,
  );
  return { problems, modules };
}

export async function syncNodeContentIdentity(
  node: GraphNode,
  parent: GraphNode | null,
) {
  if (!node.content_path || ![".md", ".mdx"].includes(path.extname(node.content_path))) {
    return null;
  }
  const filePath = path.resolve(projectRoot, node.content_path);
  const source = await fs.readFile(filePath, "utf8");
  const document = matter(source);
  document.data.node_id = node.node_id;
  document.data.primary_parent_id = node.primary_parent_id;
  document.data.content_type = node.content_type;
  if (
    ["problem_note", "unassigned_fragments", "module_summary"].includes(
      node.content_type,
    ) &&
    parent
  ) {
    document.data.module = parent.name;
  }
  const savedSource = matter.stringify(document.content, document.data);
  await writeAtomic(filePath, savedSource);
  return { filePath, before: source, after: savedSource };
}
