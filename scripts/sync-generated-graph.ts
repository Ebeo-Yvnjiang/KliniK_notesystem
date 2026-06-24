import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { allocateGraphIds } from "../lib/graph/id-allocator.ts";
import { rebuildDerivedIndexes } from "../lib/graph/derived.ts";
import {
  edgesPath,
  graphBackupsRoot,
  nodesPath,
  policiesPath,
  projectRoot,
} from "../lib/graph/paths.ts";
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  PermissionPolicy,
} from "../lib/graph/types.ts";
import { assertGraphValid } from "../lib/graph/validation.ts";

const problemDir = path.join(
  projectRoot,
  "content",
  "private",
  "subjects",
  "physics",
  "problem-notes",
);

async function writeAtomic(filePath: string, content: string) {
  const temp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  await fs.writeFile(temp, content, "utf8");
  try {
    await fs.rename(temp, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(temp, filePath);
  }
}

const data: GraphData = {
  nodes: JSON.parse(await fs.readFile(nodesPath, "utf8")) as GraphNode[],
  edges: JSON.parse(await fs.readFile(edgesPath, "utf8")) as GraphEdge[],
  permissionPolicies: JSON.parse(
    await fs.readFile(policiesPath, "utf8"),
  ) as PermissionPolicy[],
};
const originalNodes = await fs.readFile(nodesPath, "utf8");
const originalEdges = await fs.readFile(edgesPath, "utf8");
const now = new Date().toISOString();
const rawNode = data.nodes.find((node) => node.content_type === "raw_note");
if (!rawNode) throw new Error("图中缺少物理原始笔记节点。");

const containers = data.nodes.filter(
  (node) =>
    ["module", "system_placeholder"].includes(node.content_type) &&
    node.status === "active" &&
    node.node_id !== rawNode.node_id,
);
const containerByName = new Map<string, GraphNode>();
for (const node of containers) {
  containerByName.set(node.name, node);
  for (const alias of node.aliases) containerByName.set(alias, node);
}
const existingByLegacyId = new Map(
  data.nodes
    .filter((node) =>
      ["problem_note", "unassigned_fragments"].includes(node.content_type),
    )
    .map((node) => [String(node.metadata?.legacy_problem_id ?? ""), node]),
);
const existingByPath = new Map(
  data.nodes
    .filter((node) => node.content_path)
    .map((node) => [node.content_path!, node]),
);

const files = (await fs.readdir(problemDir))
  .filter((file) => file.endsWith(".mdx"))
  .sort();
const discovered = [];
for (const file of files) {
  const relativePath = path
    .relative(projectRoot, path.join(problemDir, file))
    .replaceAll("\\", "/");
  const source = await fs.readFile(path.join(problemDir, file), "utf8");
  const document = matter(source);
  const legacyId = String(document.data.id ?? path.basename(file, ".mdx"));
  discovered.push({ file, relativePath, source, document, legacyId });
}

const newItems = discovered.filter(
  (item) =>
    !existingByLegacyId.get(item.legacyId) &&
    !existingByPath.get(item.relativePath),
);
const newNodeIds = newItems.length
  ? await allocateGraphIds("node", newItems.length)
  : [];
const newEdgeIds = newItems.length
  ? await allocateGraphIds("edge", newItems.length)
  : [];
const changedFiles = new Map<string, string>();
const newNodes: GraphNode[] = [];

for (let index = 0; index < discovered.length; index += 1) {
  const item = discovered[index];
  let node =
    existingByLegacyId.get(item.legacyId) ??
    existingByPath.get(item.relativePath);
  if (!node) {
    const newIndex = newItems.findIndex(
      (candidate) => candidate.relativePath === item.relativePath,
    );
    const parent = containerByName.get(String(item.document.data.module ?? ""));
    if (!parent) {
      throw new Error(
        `新题目${item.legacyId}的模块快照无法解析到有效容器：${item.document.data.module}`,
      );
    }
    node = {
      node_id: newNodeIds[newIndex],
      node_kind: "content",
      content_type:
        item.legacyId === "unassigned-problem-fragments"
          ? "unassigned_fragments"
          : "problem_note",
      name: String(item.document.data.anchor_text ?? item.legacyId),
      primary_parent_id: parent.node_id,
      status: "active",
      sort_order:
        data.nodes.filter(
          (candidate) => candidate.primary_parent_id === parent.node_id,
        ).length +
        newNodes.filter(
          (candidate) => candidate.primary_parent_id === parent.node_id,
        ).length +
        1,
      content_path: item.relativePath,
      aliases: [],
      external_ids:
        item.document.data.anchor_type === "external_id"
          ? [item.legacyId]
          : [],
      permission_policy_id: parent.permission_policy_id,
      created_at: now,
      updated_at: now,
      metadata: {
        legacy_problem_id: item.legacyId,
        anchor_type: item.document.data.anchor_type ?? "unknown_source",
        managed_by_generator: true,
      },
    };
    newNodes.push(node);
    data.nodes.push(node);
    data.edges.push({
      edge_id: newEdgeIds[newIndex],
      from_node_id: node.node_id,
      to_node_id: rawNode.node_id,
      relation_type: "derived_from",
      metadata: { managed_by_generator: true },
      created_at: now,
    });
  }
  const parent = node.primary_parent_id
    ? data.nodes.find((candidate) => candidate.node_id === node!.primary_parent_id)
    : null;
  if (!parent) throw new Error(`题目节点${node.node_id}缺少有效主要父节点。`);
  item.document.data.node_id = node.node_id;
  item.document.data.primary_parent_id = node.primary_parent_id;
  item.document.data.module = parent.name;
  const savedSource = matter.stringify(
    item.document.content,
    item.document.data,
  );
  if (savedSource !== item.source) {
    changedFiles.set(path.join(problemDir, item.file), item.source);
    await writeAtomic(path.join(problemDir, item.file), savedSource);
  }
}

const backupDir = path.join(
  graphBackupsRoot,
  `${now.replace(/[:.]/g, "-")}-generator-sync`,
);
await fs.mkdir(backupDir, { recursive: true });
await fs.writeFile(path.join(backupDir, "nodes.json"), originalNodes, "utf8");
await fs.writeFile(path.join(backupDir, "edges.json"), originalEdges, "utf8");

try {
  assertGraphValid(data);
  await writeAtomic(nodesPath, `${JSON.stringify(data.nodes, null, 2)}\n`);
  await writeAtomic(edgesPath, `${JSON.stringify(data.edges, null, 2)}\n`);
  await rebuildDerivedIndexes(data);
  assertGraphValid(data);
} catch (error) {
  await writeAtomic(nodesPath, originalNodes);
  await writeAtomic(edgesPath, originalEdges);
  for (const [filePath, source] of changedFiles) {
    await writeAtomic(filePath, source).catch(() => undefined);
  }
  throw error;
}

console.log(
  `generated graph sync complete: new_nodes=${newNodes.length}, repaired_files=${changedFiles.size}`,
);
