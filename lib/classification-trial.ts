import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { classificationGuidancePath } from "./classification-corrections.ts";
import { projectRoot } from "./graph/paths.ts";
import {
  getGraphVersion,
  isNodeEffectivelyActive,
  readGraphData,
  resolveContentPath,
} from "./graph/store.ts";
import type { GraphData, GraphNode } from "./graph/types.ts";

const trialRoot = path.join(projectRoot, "data", "classification-trials");
export const classificationTaskPackagePath = path.join(
  trialRoot,
  "latest-task-package.json",
);
export const pendingSuggestionsPath = path.join(
  trialRoot,
  "pending-suggestions.json",
);
export const suggestionEvaluationsPath = path.join(
  trialRoot,
  "suggestion-evaluations.jsonl",
);

export type ClassificationTarget = {
  node_id: string;
  name: string;
  path: string;
  content_type: string;
};

export type ClassificationTaskItem = {
  node_id: string;
  name: string;
  current_parent: ClassificationTarget;
  content_excerpt: string;
  content_path: string;
};

export type ClassificationTaskPackage = {
  package_type: "note_system_stage_b_classification_task";
  generated_at: string;
  graph_version: string;
  source_parent: ClassificationTarget;
  target_parent_nodes: ClassificationTarget[];
  items: ClassificationTaskItem[];
  classification_guidance: string;
  instructions: string[];
  expected_response_schema: Record<string, unknown>;
};

export type AiClassificationSuggestion = {
  node_id: string;
  recommended_parent_node_id: string;
  alternative_parent_node_ids?: string[];
  reason?: string;
  confidence?: "high" | "medium" | "low" | string;
  evidence?: string[] | string;
};

export type PendingSuggestionRecord = {
  suggestion_id: string;
  imported_at: string;
  status: "pending" | "accepted" | "overridden" | "rejected" | "skipped" | "superseded";
  suggestion: AiClassificationSuggestion;
  node_snapshot: {
    node_id: string;
    name: string;
    parent_node_id: string | null;
    parent_name: string;
    content_path: string | null;
  };
  recommended_parent_snapshot: {
    node_id: string;
    name: string;
    path: string;
  };
  user_decision?: {
    decided_at: string;
    status: PendingSuggestionRecord["status"];
    final_parent_node_id?: string;
    reason?: string;
    graph_event_id?: string;
  };
};

export type PendingSuggestionStore = {
  updated_at: string;
  records: PendingSuggestionRecord[];
};

function writeAtomicSync(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(tempPath, content, "utf8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch {
    fs.rmSync(filePath, { force: true });
    fs.renameSync(tempPath, filePath);
  }
}

async function writeAtomic(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  await fsp.writeFile(tempPath, content, "utf8");
  try {
    await fsp.rename(tempPath, filePath);
  } catch {
    await fsp.rm(filePath, { force: true });
    await fsp.rename(tempPath, filePath);
  }
}

function nodePath(data: GraphData, nodeId: string) {
  const byId = new Map(data.nodes.map((node) => [node.node_id, node]));
  const parts: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(nodeId);
  while (current) {
    if (visited.has(current.node_id)) break;
    visited.add(current.node_id);
    parts.unshift(current.name);
    current = current.primary_parent_id
      ? byId.get(current.primary_parent_id)
      : undefined;
  }
  return parts.join(" / ");
}

function targetFromNode(data: GraphData, node: GraphNode): ClassificationTarget {
  return {
    node_id: node.node_id,
    name: node.name,
    path: nodePath(data, node.node_id),
    content_type: node.content_type,
  };
}

export function findUnclassifiedContainer(data = readGraphData()) {
  return (
    data.nodes.find(
      (node) =>
        node.content_type === "system_placeholder" &&
        (node.metadata?.system_placeholder === true || node.name === "未分类"),
    ) ??
    data.nodes.find(
      (node) => node.content_type === "system_placeholder" || node.name === "未分类",
    ) ??
    null
  );
}

export function getClassificationTargetParents(data = readGraphData()) {
  return data.nodes
    .filter(
      (node) =>
        node.content_type === "module" &&
        node.status === "active" &&
        isNodeEffectivelyActive(node.node_id, data.nodes),
    )
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order ||
        left.node_id.localeCompare(right.node_id),
    )
    .map((node) => targetFromNode(data, node));
}

function excerptFromNode(node: GraphNode, maxLength = 700) {
  if (!node.content_path) return "";
  const filePath = resolveContentPath(node);
  if (!filePath || !fs.existsSync(filePath)) return "";
  const source = fs.readFileSync(filePath, "utf8");
  const body = matter(source).content
    .replace(/!\[[^\]]*]\([^)]*\)/g, " [图片] ")
    .replace(/\s+/g, " ")
    .trim();
  return body.length > maxLength ? `${body.slice(0, maxLength - 1)}…` : body;
}

function readGuidance() {
  try {
    return fs.readFileSync(classificationGuidancePath, "utf8").trim();
  } catch {
    return "暂无分类经验摘要。请先运行 npm.cmd run corrections:build-guidance。";
  }
}

export function buildUnclassifiedClassificationTaskPackage(options?: {
  limit?: number;
}) {
  const data = readGraphData();
  const unclassified = findUnclassifiedContainer(data);
  if (!unclassified) {
    throw new Error("找不到未分类容器，无法导出阶段B分类任务包。");
  }
  const byId = new Map(data.nodes.map((node) => [node.node_id, node]));
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  const sourceParent = targetFromNode(data, unclassified);
  const items = data.nodes
    .filter(
      (node) =>
        node.primary_parent_id === unclassified.node_id &&
        node.content_type === "problem_note" &&
        Boolean(node.content_path) &&
        isNodeEffectivelyActive(node.node_id, data.nodes),
    )
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order ||
        left.node_id.localeCompare(right.node_id),
    )
    .slice(0, limit)
    .map((node) => {
      const parent = node.primary_parent_id ? byId.get(node.primary_parent_id) : null;
      return {
        node_id: node.node_id,
        name: node.name,
        current_parent: parent ? targetFromNode(data, parent) : sourceParent,
        content_excerpt: excerptFromNode(node),
        content_path: node.content_path!,
      } satisfies ClassificationTaskItem;
    });

  const taskPackage: ClassificationTaskPackage = {
    package_type: "note_system_stage_b_classification_task",
    generated_at: new Date().toISOString(),
    graph_version: getGraphVersion(),
    source_parent: sourceParent,
    target_parent_nodes: getClassificationTargetParents(data),
    items,
    classification_guidance: readGuidance(),
    instructions: [
      "只给分类建议，不要改写题目正文。",
      "recommended_parent_node_id 必须从 target_parent_nodes 中选择。",
      "不确定时使用低置信度，并在 reason 中说明不确定点。",
      "返回 JSON，不要返回 Markdown 包裹。",
      "AI 建议不会自动移动节点，用户会在网页中逐条确认。",
    ],
    expected_response_schema: {
      suggestions: [
        {
          node_id: "00000000",
          recommended_parent_node_id: "00000000",
          alternative_parent_node_ids: ["00000000"],
          reason: "推荐理由",
          confidence: "high | medium | low",
          evidence: ["使用到的经验依据或关键词"],
        },
      ],
    },
  };
  writeAtomicSync(
    classificationTaskPackagePath,
    `${JSON.stringify(taskPackage, null, 2)}\n`,
  );
  return taskPackage;
}

export function readPendingSuggestionStore(): PendingSuggestionStore {
  try {
    return JSON.parse(
      fs.readFileSync(pendingSuggestionsPath, "utf8"),
    ) as PendingSuggestionStore;
  } catch {
    return { updated_at: new Date(0).toISOString(), records: [] };
  }
}

async function writePendingSuggestionStore(store: PendingSuggestionStore) {
  await writeAtomic(
    pendingSuggestionsPath,
    `${JSON.stringify(store, null, 2)}\n`,
  );
}

function normalizeSuggestionInput(input: unknown): AiClassificationSuggestion[] {
  const value =
    typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  const suggestions = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { suggestions?: unknown }).suggestions)
      ? (value as { suggestions: unknown[] }).suggestions
      : null;
  if (!suggestions) {
    throw new Error("AI建议必须是数组，或形如 { suggestions: [...] } 的JSON对象。");
  }
  return suggestions.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("AI建议条目必须是对象。");
    }
    const record = item as Record<string, unknown>;
    const nodeId = String(record.node_id ?? "").trim();
    const recommendedParentNodeId = String(
      record.recommended_parent_node_id ??
        record.target_parent_node_id ??
        record.recommended_target_parent_node_id ??
        "",
    ).trim();
    if (!/^\d{8}$/.test(nodeId)) {
      throw new Error(`AI建议中的 node_id 无效：${nodeId || "(空)"}`);
    }
    if (!/^\d{8}$/.test(recommendedParentNodeId)) {
      throw new Error(
        `AI建议 ${nodeId} 的 recommended_parent_node_id 无效：${
          recommendedParentNodeId || "(空)"
        }`,
      );
    }
    const alternatives = Array.isArray(record.alternative_parent_node_ids)
      ? record.alternative_parent_node_ids.map(String).filter((id) => /^\d{8}$/.test(id))
      : [];
    const evidence = Array.isArray(record.evidence)
      ? record.evidence.map(String)
      : typeof record.evidence === "string"
        ? record.evidence
        : [];
    return {
      node_id: nodeId,
      recommended_parent_node_id: recommendedParentNodeId,
      alternative_parent_node_ids: alternatives,
      reason: typeof record.reason === "string" ? record.reason : "",
      confidence: typeof record.confidence === "string" ? record.confidence : "low",
      evidence,
    };
  });
}

export async function importAiClassificationSuggestions(input: unknown) {
  const data = readGraphData();
  const byId = new Map(data.nodes.map((node) => [node.node_id, node]));
  const targetIds = new Set(getClassificationTargetParents(data).map((node) => node.node_id));
  const suggestions = normalizeSuggestionInput(input);
  const store = readPendingSuggestionStore();
  let imported = 0;
  const errors: string[] = [];

  for (const suggestion of suggestions) {
    const node = byId.get(suggestion.node_id);
    const parent = node?.primary_parent_id ? byId.get(node.primary_parent_id) : null;
    const target = byId.get(suggestion.recommended_parent_node_id);
    if (!node || node.content_type !== "problem_note" || !node.content_path) {
      errors.push(`${suggestion.node_id}: 未关联有效题目节点。`);
      continue;
    }
    if (!target || !targetIds.has(target.node_id)) {
      errors.push(
        `${suggestion.node_id}: 推荐目标 ${suggestion.recommended_parent_node_id} 不在可用目标父节点列表中。`,
      );
      continue;
    }
    for (const existing of store.records) {
      if (existing.status === "pending" && existing.suggestion.node_id === node.node_id) {
        existing.status = "superseded";
        existing.user_decision = {
          decided_at: new Date().toISOString(),
          status: "superseded",
          reason: "被后续导入的AI建议取代。",
        };
      }
    }
    store.records.push({
      suggestion_id: crypto.randomUUID(),
      imported_at: new Date().toISOString(),
      status: "pending",
      suggestion,
      node_snapshot: {
        node_id: node.node_id,
        name: node.name,
        parent_node_id: node.primary_parent_id,
        parent_name: parent?.name ?? "",
        content_path: node.content_path,
      },
      recommended_parent_snapshot: {
        node_id: target.node_id,
        name: target.name,
        path: nodePath(data, target.node_id),
      },
    });
    imported += 1;
  }
  store.updated_at = new Date().toISOString();
  await writePendingSuggestionStore(store);
  return { imported, errors };
}

export async function recordSuggestionDecision(input: {
  suggestionId: string;
  status: "accepted" | "overridden" | "rejected" | "skipped";
  finalParentNodeId?: string;
  reason?: string;
  graphEventId?: string;
}) {
  const store = readPendingSuggestionStore();
  const record = store.records.find(
    (item) => item.suggestion_id === input.suggestionId,
  );
  if (!record) throw new Error(`找不到AI建议记录：${input.suggestionId}`);
  if (record.status !== "pending") {
    throw new Error(`该建议已经处理，当前状态：${record.status}`);
  }
  record.status = input.status;
  record.user_decision = {
    decided_at: new Date().toISOString(),
    status: input.status,
    final_parent_node_id: input.finalParentNodeId,
    reason: input.reason?.trim() ?? "",
    graph_event_id: input.graphEventId,
  };
  store.updated_at = new Date().toISOString();
  await writePendingSuggestionStore(store);
  await fsp.mkdir(trialRoot, { recursive: true });
  await fsp.appendFile(
    suggestionEvaluationsPath,
    `${JSON.stringify({
      event_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      suggestion_id: input.suggestionId,
      node_id: record.suggestion.node_id,
      recommended_parent_node_id: record.suggestion.recommended_parent_node_id,
      status: input.status,
      final_parent_node_id: input.finalParentNodeId ?? null,
      reason: input.reason?.trim() ?? "",
      graph_event_id: input.graphEventId ?? null,
    })}\n`,
    "utf8",
  );
  return record;
}
