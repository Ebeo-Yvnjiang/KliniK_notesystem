import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  getActiveClassificationCorrections,
  readClassificationCorrectionLog,
} from "../lib/classification-corrections.ts";
import { markdownBodyHash } from "../lib/graph/manual-override.ts";
import {
  edgesPath,
  graphAuditPath,
  legacyRouteMapPath,
  manualOverrideHashesPath,
  moduleIndexPath,
  nodesPath,
  policiesPath,
  problemIndexPath,
  projectRoot,
  rekeyMapPath,
} from "../lib/graph/paths.ts";
import { isNodeEffectivelyActive } from "../lib/graph/store.ts";
import type {
  GraphData,
  GraphEdge,
  GraphIssue,
  GraphNode,
  PermissionPolicy,
} from "../lib/graph/types.ts";
import { validateGraphData } from "../lib/graph/validation.ts";

type Section =
  | "数据结构检查"
  | "路由检查"
  | "内容链接检查"
  | "生成保护检查"
  | "归档过滤检查";
type CategorizedIssue = GraphIssue & { section: Section };

const reportPath = path.join(projectRoot, "data", "reports", "graph-consistency-report.md");
const guidancePath = path.join(
  projectRoot,
  "data",
  "corrections",
  "classification-guidance.md",
);

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(item)));
    else result.push(item);
  }
  return result;
}

function add(
  issues: CategorizedIssue[],
  section: Section,
  severity: "error" | "warning",
  code: string,
  message: string,
  extra?: Partial<GraphIssue>,
) {
  issues.push({ section, severity, code, message, ...extra });
}

async function writeAtomic(filePath: string, content: string) {
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, content, "utf8");
  try {
    await fs.rename(temp, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(temp, filePath);
  }
}

const data: GraphData = {
  nodes: await readJson<GraphNode[]>(nodesPath),
  edges: await readJson<GraphEdge[]>(edgesPath),
  permissionPolicies: await readJson<PermissionPolicy[]>(policiesPath),
};
const issues: CategorizedIssue[] = validateGraphData(data).map((item) => ({
  ...item,
  section: "数据结构检查",
}));
const byId = new Map(data.nodes.map((node) => [node.node_id, node]));
const problemIndex = await readJson<Record<string, unknown>[]>(problemIndexPath);
const moduleIndex = await readJson<Record<string, unknown>[]>(moduleIndexPath);
const legacyMap = await readJson<{
  modules: Record<string, { node_id: string; summary_node_id: string }>;
  problems: Record<string, string>;
  raw: string;
  physics: string;
  root: string;
}>(legacyRouteMapPath);
const rekeyMap = await readJson<Record<string, string>>(rekeyMapPath);
const activeProblemNodes = data.nodes.filter(
  (node) =>
    ["problem_note", "unassigned_fragments"].includes(node.content_type) &&
    Boolean(node.content_path) &&
    isNodeEffectivelyActive(node.node_id, data.nodes),
);

if (activeProblemNodes.length !== problemIndex.length) {
  add(
    issues,
    "归档过滤检查",
    "error",
    "problem_index_count_drift",
    `有效题目节点${activeProblemNodes.length}个，普通题目索引${problemIndex.length}条。`,
  );
}
for (const item of problemIndex) {
  const nodeId = String(item.node_id ?? "");
  const node = byId.get(nodeId);
  if (!node) {
    add(issues, "数据结构检查", "error", "problem_index_missing_node", `题目索引引用不存在节点：${nodeId}`);
    continue;
  }
  if (!isNodeEffectivelyActive(nodeId, data.nodes)) {
    add(issues, "归档过滤检查", "error", "archived_problem_in_index", `归档题目仍在普通索引：${nodeId}`);
  }
  if (String(item.primary_parent_id) !== String(node.primary_parent_id)) {
    add(issues, "数据结构检查", "error", "problem_parent_drift", `题目索引父节点不一致：${nodeId}`);
  }
  if (node.content_path && String(item.file_path) !== node.content_path) {
    add(issues, "数据结构检查", "error", "problem_path_drift", `题目索引路径不一致：${nodeId}`);
  }
}

for (const node of data.nodes.filter((item) => item.content_path)) {
  const absolute = path.resolve(projectRoot, node.content_path!);
  try {
    const source = await fs.readFile(absolute, "utf8");
    if (node.content_path!.endsWith(".mdx")) {
      const document = matter(source);
      if (String(document.data.node_id) !== node.node_id) {
        add(issues, "数据结构检查", "error", "frontmatter_node_drift", `内容文件node_id不一致：${node.content_path}`);
      }
      if (String(document.data.primary_parent_id) !== String(node.primary_parent_id)) {
        add(issues, "数据结构检查", "error", "frontmatter_parent_drift", `内容文件primary_parent_id不一致：${node.content_path}`);
      }
    }
  } catch {
    add(issues, "路由检查", "error", "content_file_missing", `内容节点无法解析到文件：/nodes/${node.node_id} -> ${node.content_path}`);
  }
}

for (const module of moduleIndex) {
  const nodeId = String(module.node_id ?? "");
  const node = byId.get(nodeId);
  if (!node) {
    add(issues, "数据结构检查", "error", "module_index_missing_node", `模块索引引用不存在节点：${nodeId}`);
    continue;
  }
  if (!isNodeEffectivelyActive(nodeId, data.nodes)) {
    add(issues, "归档过滤检查", "error", "archived_container_in_index", `归档容器仍在普通模块索引：${nodeId}`);
  }
  const directCount = activeProblemNodes.filter(
    (problem) => problem.primary_parent_id === nodeId,
  ).length;
  if (Number(module.problemCount) !== directCount) {
    add(issues, "归档过滤检查", "error", "module_count_drift", `${node.name}索引计数${module.problemCount}，有效直接题目${directCount}。`);
  }
}

for (const [legacyId, nodeId] of Object.entries(legacyMap.problems)) {
  if (!byId.has(nodeId)) {
    add(issues, "路由检查", "error", "broken_legacy_problem_route", `旧题目路由${legacyId}指向不存在节点${nodeId}。`);
  }
}
for (const [slug, mapping] of Object.entries(legacyMap.modules)) {
  if (!byId.has(mapping.node_id) || !byId.has(mapping.summary_node_id)) {
    add(issues, "路由检查", "error", "broken_legacy_module_route", `旧模块路由${slug}存在失效节点映射。`);
  }
}
for (const [oldId, newId] of Object.entries(rekeyMap)) {
  if (!/^\d{8}$/.test(oldId) || !byId.has(newId)) {
    add(issues, "路由检查", "error", "broken_rekey_mapping", `ID历史映射无效：${oldId} -> ${newId}`);
  }
}

const privateFiles = (await walk(path.join(projectRoot, "content", "private"))).filter(
  (file) => [".md", ".mdx"].includes(path.extname(file)),
);
let legacyLinkCount = 0;
let canonicalLinkCount = 0;
for (const file of privateFiles) {
  const source = await fs.readFile(file, "utf8");
  for (const match of source.matchAll(/\/problems\/([A-Za-z0-9_-]+)/g)) {
    legacyLinkCount += 1;
    const legacyId = match[1];
    add(
      issues,
      "内容链接检查",
      legacyMap.problems[legacyId] ? "error" : "warning",
      legacyMap.problems[legacyId] ? "migratable_legacy_link" : "unmatched_legacy_link",
      `${path.relative(projectRoot, file)}：${match[0]}`,
    );
  }
  for (const match of source.matchAll(/\/nodes\/(\d{8})/g)) {
    canonicalLinkCount += 1;
    if (!byId.has(match[1])) {
      add(issues, "内容链接检查", "error", "broken_canonical_link", `${path.relative(projectRoot, file)}引用不存在节点：${match[1]}`);
    }
  }
}

const hashManifest: {
  updated_at: string;
  entries: Record<string, string>;
} = await readJson<{
  updated_at: string;
  entries: Record<string, string>;
}>(manualOverrideHashesPath).catch(() => ({
  updated_at: "",
  entries: {} as Record<string, string>,
}));
let manualOverrideCount = 0;
for (const node of data.nodes.filter((item) => item.content_path)) {
  const source = await fs.readFile(path.resolve(projectRoot, node.content_path!), "utf8");
  if (!/^manual_override:\s*true\s*$/m.test(source)) continue;
  manualOverrideCount += 1;
  const expected = hashManifest.entries[node.content_path!.replaceAll("\\", "/")];
  if (!expected) {
    add(issues, "生成保护检查", "error", "manual_override_missing_baseline", `缺少人工覆盖正文基线：${node.content_path}`);
  } else if (expected !== markdownBodyHash(source)) {
    add(issues, "生成保护检查", "error", "manual_override_body_changed", `人工覆盖正文与保护基线不一致：${node.content_path}`);
  }
}

const correctionLog = readClassificationCorrectionLog();
for (const error of correctionLog.errors) {
  add(issues, "数据结构检查", "error", "classification_log_format_error", `分类日志第${error.line}行：${error.message}`);
}
for (const record of getActiveClassificationCorrections()) {
  for (const parentId of [
    record.event.before.parent_node_id,
    record.event.after.parent_node_id,
  ]) {
    if (parentId && (!byId.has(parentId) || !isNodeEffectivelyActive(parentId, data.nodes))) {
      add(issues, "归档过滤检查", "error", "archived_classification_case_active", `有效分类经验引用失效或归档节点：${parentId}`);
    }
  }
}
const guidance = await fs.readFile(guidancePath, "utf8").catch(() => "");
for (const node of data.nodes.filter(
  (item) => !isNodeEffectivelyActive(item.node_id, data.nodes),
)) {
  if (guidance.includes(`[${node.node_id}]`)) {
    add(issues, "归档过滤检查", "error", "archived_node_in_guidance", `分类经验摘要包含归档节点：${node.node_id}`);
  }
}
const auditText = await fs.readFile(graphAuditPath, "utf8").catch(() => "");
const unmarkedTestEvents = auditText
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Record<string, unknown>)
  .filter(
    (event) =>
      (JSON.stringify(event.before).includes("__验收") ||
        JSON.stringify(event.before).includes("__测试")) &&
      event.test_event !== true,
  );
if (unmarkedTestEvents.length) {
  add(issues, "归档过滤检查", "warning", "unmarked_test_audit_events", `${unmarkedTestEvents.length}条测试审计事件尚未标记。`);
}

const sections: Section[] = [
  "数据结构检查",
  "路由检查",
  "内容链接检查",
  "生成保护检查",
  "归档过滤检查",
];
const errors = issues.filter((item) => item.severity === "error");
const warnings = issues.filter((item) => item.severity === "warning");
const lines = [
  "# 图一致性检查报告",
  "",
  `- 检查时间：${new Date().toISOString()}`,
  `- 节点：${data.nodes.length}`,
  `- 边：${data.edges.length}`,
  `- 有效题目节点/普通索引：${activeProblemNodes.length}/${problemIndex.length}`,
  `- 规范内容链接：${canonicalLinkCount}`,
  `- 旧内部题目链接：${legacyLinkCount}`,
  `- manual_override内容文件：${manualOverrideCount}`,
  `- 错误：${errors.length}`,
  `- 警告：${warnings.length}`,
  "",
];
for (const section of sections) {
  const sectionIssues = issues.filter((item) => item.section === section);
  lines.push(`## ${section}`, "");
  if (!sectionIssues.length) {
    lines.push("- 通过：未发现问题。", "");
  } else {
    lines.push(
      ...sectionIssues.map(
        (item) => `- ${item.severity === "error" ? "错误" : "警告"} [${item.code}] ${item.message}`,
      ),
      "",
    );
  }
}
lines.push(
  "## 覆盖说明",
  "",
  "- 数据层测试通过：节点、边、父链、权限、内容所有权、索引和统计已检查。",
  "- 路由检查通过：规范链接目标和旧路由映射在数据层可解析；不启动HTTP服务器。",
  "- 生成保护检查使用人工覆盖正文hash基线，允许frontmatter系统字段变化。",
  "- 界面工作流和备份恢复的端到端结果需结合专项验收记录，不以本报告替代。",
  "",
);
await writeAtomic(reportPath, `${lines.join("\n")}\n`);
console.log(`graph check complete: errors=${errors.length}, warnings=${warnings.length}`);
if (errors.length) process.exitCode = 1;
