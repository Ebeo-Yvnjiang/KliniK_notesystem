import fs from "node:fs/promises";
import path from "node:path";
import {
  buildClassificationGuidance,
  classificationGuidancePath,
  classificationLogPath,
  getActiveClassificationCorrections,
} from "../lib/classification-corrections.ts";
import {
  buildUnclassifiedClassificationTaskPackage,
  classificationTaskPackagePath,
  importAiClassificationSuggestions,
  pendingSuggestionsPath,
  readPendingSuggestionStore,
  recordSuggestionDecision,
  suggestionEvaluationsPath,
} from "../lib/classification-trial.ts";
import { executeGraphAction, previewGraphAction } from "../lib/graph/operations.ts";
import {
  edgesPath,
  legacyRouteMapPath,
  moduleIndexPath,
  nodesPath,
  problemIndexPath,
  projectRoot,
} from "../lib/graph/paths.ts";
import { getGraphVersion, readGraphData } from "../lib/graph/store.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function readMaybe(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function writeMaybe(filePath: string, content: string | null) {
  if (content === null) {
    await fs.rm(filePath, { force: true });
  } else {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
}

const snapshotPaths = [
  nodesPath,
  edgesPath,
  legacyRouteMapPath,
  problemIndexPath,
  moduleIndexPath,
  classificationLogPath,
  classificationGuidancePath,
  classificationTaskPackagePath,
  pendingSuggestionsPath,
  suggestionEvaluationsPath,
];
const snapshots = new Map<string, string | null>();
for (const filePath of snapshotPaths) {
  snapshots.set(filePath, await readMaybe(filePath));
}

const beforeData = readGraphData();
const unclassified = beforeData.nodes.find(
  (node) => node.content_type === "system_placeholder" || node.name === "未分类",
);
assert(unclassified, "缺少未分类容器，无法测试阶段B任务包。");
const testProblem = beforeData.nodes.find(
  (node) =>
    node.primary_parent_id === unclassified.node_id &&
    node.content_type === "problem_note" &&
    Boolean(node.content_path),
);
const target = beforeData.nodes.find(
  (node) =>
    node.content_type === "module" &&
    node.status === "active" &&
    node.node_id !== testProblem?.primary_parent_id,
);
assert(testProblem && target, "缺少未分类题目或可用目标模块。");
const problemSourcePath = path.join(projectRoot, testProblem.content_path!);
const originalProblemSource = await fs.readFile(problemSourcePath, "utf8");
const initialLog = (await readMaybe(classificationLogPath)) ?? "";

try {
  const taskPackage = buildUnclassifiedClassificationTaskPackage({ limit: 3 });
  assert(taskPackage.items.length > 0, "未分类任务包没有导出题目。");
  assert(
    taskPackage.items.some((item) => item.node_id === testProblem.node_id),
    "未分类任务包没有包含测试题目。",
  );
  assert(
    taskPackage.target_parent_nodes.some((item) => item.node_id === target.node_id),
    "未分类任务包没有包含可用目标父节点。",
  );
  assert(
    JSON.stringify(taskPackage.expected_response_schema).includes(
      "recommended_parent_node_id",
    ),
    "任务包没有声明AI建议JSON schema。",
  );

  const importResult = await importAiClassificationSuggestions({
    suggestions: [
      {
        node_id: testProblem.node_id,
        recommended_parent_node_id: target.node_id,
        alternative_parent_node_ids: [],
        reason: "测试建议：题目语义更接近目标模块。",
        confidence: "medium",
        evidence: ["测试关键词"],
      },
    ],
  });
  assert(importResult.imported === 1, "AI建议没有导入为待确认记录。");
  const pending = readPendingSuggestionStore().records.find(
    (record) =>
      record.status === "pending" &&
      record.suggestion.node_id === testProblem.node_id,
  );
  assert(pending, "找不到刚导入的待确认AI建议。");

  await recordSuggestionDecision({
    suggestionId: pending.suggestion_id,
    status: "rejected",
    reason: "测试拒绝，不应移动节点。",
  });
  assert(
    readGraphData().nodes.find((node) => node.node_id === testProblem.node_id)
      ?.primary_parent_id === unclassified.node_id,
    "拒绝AI建议错误地移动了节点。",
  );

  const secondImport = await importAiClassificationSuggestions({
    suggestions: [
      {
        node_id: testProblem.node_id,
        recommended_parent_node_id: target.node_id,
        reason: "测试建议：再次导入。",
        confidence: "high",
        evidence: ["测试二次导入"],
      },
    ],
  });
  assert(secondImport.imported === 1, "第二次AI建议导入失败。");
  const secondPending = readPendingSuggestionStore().records.find(
    (record) =>
      record.status === "pending" &&
      record.suggestion.node_id === testProblem.node_id,
  );
  assert(secondPending, "找不到第二条待确认AI建议。");

  const preview = previewGraphAction("move", {
    node_id: testProblem.node_id,
    target_parent_id: target.node_id,
    classification_evidence: true,
    reason: "阶段B测试：接受AI建议前必须走图移动预览。",
  }) as { classification_evidence?: boolean };
  assert(
    preview.classification_evidence === true,
    "接受AI建议没有进入现有分类移动预览流程。",
  );
  const accepted = await executeGraphAction(
    "move",
    {
      node_id: testProblem.node_id,
      target_parent_id: target.node_id,
      classification_evidence: true,
      reason: "阶段B测试：接受AI建议。",
    },
    "test",
    getGraphVersion(),
  );
  await recordSuggestionDecision({
    suggestionId: secondPending.suggestion_id,
    status: "accepted",
    finalParentNodeId: target.node_id,
    reason: "阶段B测试：接受AI建议。",
    graphEventId: accepted.event.event_id,
  });
  assert(
    ((await readMaybe(classificationLogPath)) ?? "").length > initialLog.length,
    "分类移动没有写入分类经验日志。",
  );
  assert(
    getActiveClassificationCorrections().some(
      ({ event }) =>
        event.content_id ===
          String(testProblem.metadata?.legacy_problem_id ?? testProblem.node_id) &&
        event.after.parent_node_id === target.node_id,
    ),
    "分类移动没有成为当前有效分类经验。",
  );

  const guidance = await buildClassificationGuidance();
  assert(guidance.guidance.includes(`[${target.node_id}]`), "分类摘要没有使用node_id。");
  assert(
    guidance.guidance.length < 16000,
    "分类摘要过长，可能复制了完整历史流水。",
  );

  const moveBack = await executeGraphAction(
    "move",
    {
      node_id: testProblem.node_id,
      target_parent_id: unclassified.node_id,
      classification_evidence: false,
      reason: "阶段B测试：结构性恢复，不污染分类经验。",
    },
    "test",
    getGraphVersion(),
  );
  assert(moveBack.classificationEventId === null, "非分类移动污染了分类经验。");

  const skipImport = await importAiClassificationSuggestions({
    suggestions: [
      {
        node_id: testProblem.node_id,
        recommended_parent_node_id: target.node_id,
        reason: "测试建议：跳过。",
        confidence: "low",
        evidence: ["跳过测试"],
      },
    ],
  });
  assert(skipImport.imported === 1, "跳过测试建议导入失败。");
  const skipPending = readPendingSuggestionStore().records.find(
    (record) =>
      record.status === "pending" &&
      record.suggestion.node_id === testProblem.node_id,
  );
  assert(skipPending, "找不到跳过测试建议。");
  await recordSuggestionDecision({
    suggestionId: skipPending.suggestion_id,
    status: "skipped",
    reason: "测试跳过，不应移动节点。",
  });
  assert(
    readGraphData().nodes.find((node) => node.node_id === testProblem.node_id)
      ?.primary_parent_id === unclassified.node_id,
    "跳过AI建议错误地移动了节点。",
  );

  console.log(
    JSON.stringify({
      task_items: taskPackage.items.length,
      targets: taskPackage.target_parent_nodes.length,
      imported_suggestions: 3,
      accepted_requires_graph_move: true,
      rejected_or_skipped_does_not_move: true,
      guidance_uses_node_id: true,
    }),
  );
} finally {
  for (const [filePath, content] of [...snapshots.entries()].reverse()) {
    await writeMaybe(filePath, content);
  }
  await fs.writeFile(problemSourcePath, originalProblemSource, "utf8");
}
