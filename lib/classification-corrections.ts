import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { isNodeEffectivelyActive, readGraphData } from "./graph/store.ts";

export type ClassificationSnapshot = {
  module: string;
  submodule: string;
  classification_status: string;
  classification_confidence?: string;
  content_type?: string;
  parent_node_id?: string;
  parent_name_snapshot?: string;
};

export type ClassificationCorrectionEvent = {
  event_id: string;
  event_type?:
    | "classification_correction"
    | "problem_primary_parent_changed"
    | "invalidation";
  timestamp: string;
  source: "manual_editor";
  file_path: string;
  content_id: string;
  anchor_text: string;
  content_excerpt: string;
  content_hash_before: string;
  content_hash_after: string;
  before: ClassificationSnapshot;
  after: ClassificationSnapshot;
  changed_fields: string[];
  reason: string;
  reason_source: "user_provided" | "unspecified";
  active: boolean;
  supersedes_event_id: string | null;
};

export type ParsedCorrectionLog = {
  events: ClassificationCorrectionEvent[];
  errors: { line: number; message: string }[];
};

export type CorrectionRecord = {
  event: ClassificationCorrectionEvent;
  superseded: boolean;
  stale: boolean;
};

const correctionsRoot = path.join(process.cwd(), "data", "corrections");
export const classificationLogPath = path.join(
  correctionsRoot,
  "classification-corrections.jsonl",
);
export const classificationGuidancePath = path.join(
  correctionsRoot,
  "classification-guidance.md",
);
const projectRoot = path.resolve(process.cwd());
const allowedContentRoots = [
  path.resolve(
    projectRoot,
    "content",
    "private",
    "subjects",
    "physics",
    "problem-notes",
  ),
  path.resolve(
    projectRoot,
    "content",
    "private",
    "subjects",
    "physics",
    "modules",
  ),
];

const trackedFields = [
  "module",
  "submodule",
  "classification_status",
  "classification_confidence",
  "content_type",
] as const;

function stringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function classificationSnapshot(
  data: Record<string, unknown>,
): ClassificationSnapshot {
  return {
    module: stringValue(data.module),
    submodule: stringValue(data.submodule),
    classification_status: stringValue(data.classification_status),
    classification_confidence: stringValue(data.classification_confidence),
    content_type: stringValue(data.content_type),
  };
}

export function parentClassificationSnapshot(input: {
  parentNodeId: string;
  parentName: string;
}): ClassificationSnapshot {
  return {
    module: input.parentName,
    submodule: "",
    classification_status: "",
    classification_confidence: "",
    content_type: "",
    parent_node_id: input.parentNodeId,
    parent_name_snapshot: input.parentName,
  };
}

function isClassificationEvidenceEvent(event: ClassificationCorrectionEvent) {
  return (
    (event.event_type ?? "classification_correction") ===
      "classification_correction" ||
    event.event_type === "problem_primary_parent_changed"
  );
}

export function changedClassificationFields(
  before: ClassificationSnapshot,
  after: ClassificationSnapshot,
) {
  return trackedFields.filter(
    (field) => stringValue(before[field]) !== stringValue(after[field]),
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function hashContentSource(source: string) {
  const document = matter(source);
  const data = { ...document.data };
  delete data.manual_override;
  delete data.last_manual_edit_at;
  const canonical = JSON.stringify({
    data: stableValue(data),
    content: document.content.replace(/\r\n/g, "\n"),
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function contentExcerpt(source: string, maxLength = 240) {
  const content = matter(source).content
    .replace(/!\[[^\]]*]\([^)]*\)/g, " [图片] ")
    .replace(/[#>*_`~|\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return content.length > maxLength
    ? `${content.slice(0, maxLength - 1)}…`
    : content;
}

export function projectRelativePath(filePath: string) {
  const resolved = path.resolve(filePath);
  if (
    !allowedContentRoots.some(
      (root) => resolved.startsWith(`${root}${path.sep}`) && resolved !== root,
    )
  ) {
    throw new Error("分类修正日志只允许引用 private 物理内容白名单目录。");
  }
  const relative = path.relative(projectRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("无法生成安全的项目相对路径。");
  }
  return relative.split(path.sep).join("/");
}

function absoluteLoggedPath(filePath: string) {
  const normalized = filePath.replaceAll("/", path.sep);
  const resolved = path.resolve(projectRoot, normalized);
  projectRelativePath(resolved);
  return resolved;
}

function isSnapshot(value: unknown): value is ClassificationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return ["module", "submodule", "classification_status"].every(
    (key) => typeof snapshot[key] === "string",
  );
}

function isCorrectionEvent(
  value: unknown,
): value is ClassificationCorrectionEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.event_id === "string" &&
    typeof event.timestamp === "string" &&
    event.source === "manual_editor" &&
    typeof event.file_path === "string" &&
    typeof event.content_id === "string" &&
    typeof event.anchor_text === "string" &&
    typeof event.content_excerpt === "string" &&
    typeof event.content_hash_before === "string" &&
    typeof event.content_hash_after === "string" &&
    isSnapshot(event.before) &&
    isSnapshot(event.after) &&
    Array.isArray(event.changed_fields) &&
    event.changed_fields.every((item) => typeof item === "string") &&
    typeof event.reason === "string" &&
    (event.reason_source === "user_provided" ||
      event.reason_source === "unspecified") &&
    typeof event.active === "boolean" &&
    (event.supersedes_event_id === null ||
      typeof event.supersedes_event_id === "string")
  );
}

export function readClassificationCorrectionLog(): ParsedCorrectionLog {
  if (!fs.existsSync(classificationLogPath)) return { events: [], errors: [] };
  const lines = fs.readFileSync(classificationLogPath, "utf8").split(/\r?\n/);
  const events: ClassificationCorrectionEvent[] = [];
  const errors: { line: number; message: string }[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isCorrectionEvent(parsed)) {
        errors.push({ line: index + 1, message: "字段缺失或类型无效" });
        return;
      }
      projectRelativePath(absoluteLoggedPath(parsed.file_path));
      events.push(parsed);
    } catch (error) {
      errors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : "JSON 解析失败",
      });
    }
  });
  return { events, errors };
}

function staleEvent(
  event: ClassificationCorrectionEvent,
  currentHashByPath: Map<string, string | null>,
) {
  try {
    const filePath = absoluteLoggedPath(event.file_path);
    if (!currentHashByPath.has(filePath)) {
      currentHashByPath.set(
        filePath,
        fs.existsSync(filePath)
          ? hashContentSource(fs.readFileSync(filePath, "utf8"))
          : null,
      );
    }
    return currentHashByPath.get(filePath) !== event.content_hash_after;
  } catch {
    return true;
  }
}

export function getClassificationCorrectionRecords(): {
  records: CorrectionRecord[];
  errors: ParsedCorrectionLog["errors"];
} {
  const parsed = readClassificationCorrectionLog();
  const supersededIds = new Set(
    parsed.events
      .map((event) => event.supersedes_event_id)
      .filter((id): id is string => Boolean(id)),
  );
  const currentHashByPath = new Map<string, string | null>();
  return {
    records: parsed.events.map((event) => ({
      event,
      superseded: supersededIds.has(event.event_id),
      stale: staleEvent(event, currentHashByPath),
    })),
    errors: parsed.errors,
  };
}

export function getActiveClassificationCorrections(filters?: {
  fromModule?: string;
  toModule?: string;
}) {
  const graph = readGraphData();
  const byContentPath = new Map(
    graph.nodes
      .filter((node) => node.content_path)
      .map((node) => [node.content_path!.replaceAll("\\", "/"), node]),
  );
  return getClassificationCorrectionRecords().records
    .filter(
      ({ event, superseded, stale }) => {
        const node = byContentPath.get(event.file_path.replaceAll("\\", "/"));
        return (
          isClassificationEvidenceEvent(event) &&
          event.active &&
          !superseded &&
          !stale &&
          Boolean(node) &&
          isNodeEffectivelyActive(node!.node_id, graph.nodes)
        );
      },
    )
    .filter(
      ({ event }) =>
        !filters?.fromModule || event.before.module === filters.fromModule,
    )
    .filter(
      ({ event }) =>
        !filters?.toModule || event.after.module === filters.toModule,
    );
}

function latestActiveForContent(contentId: string) {
  return getClassificationCorrectionRecords()
    .records.filter(
      ({ event, superseded }) =>
        event.content_id === contentId &&
        event.active &&
        !superseded &&
        isClassificationEvidenceEvent(event),
    )
    .sort((left, right) =>
      right.event.timestamp.localeCompare(left.event.timestamp),
    )[0]?.event;
}

export function createClassificationCorrectionEvent(input: {
  filePath: string;
  contentId: string;
  anchorText: string;
  sourceBefore: string;
  sourceAfter: string;
  before: ClassificationSnapshot;
  after: ClassificationSnapshot;
  reason?: string;
}) {
  const changedFields = changedClassificationFields(input.before, input.after);
  if (!changedFields.length) return null;
  const reason = input.reason?.trim() ?? "";
  return {
    event_id: crypto.randomUUID(),
    event_type: "classification_correction",
    timestamp: new Date().toISOString(),
    source: "manual_editor",
    file_path: projectRelativePath(input.filePath),
    content_id: input.contentId,
    anchor_text: input.anchorText,
    content_excerpt: contentExcerpt(input.sourceAfter),
    content_hash_before: hashContentSource(input.sourceBefore),
    content_hash_after: hashContentSource(input.sourceAfter),
    before: input.before,
    after: input.after,
    changed_fields: [...changedFields],
    reason,
    reason_source: reason ? "user_provided" : "unspecified",
    active: true,
    supersedes_event_id:
      latestActiveForContent(input.contentId)?.event_id ?? null,
  } satisfies ClassificationCorrectionEvent;
}

export function createProblemParentCorrectionEvent(input: {
  filePath: string;
  contentId: string;
  anchorText: string;
  sourceBefore: string;
  sourceAfter: string;
  beforeParent: { node_id: string; name: string };
  afterParent: { node_id: string; name: string };
  reason?: string;
}) {
  if (input.beforeParent.node_id === input.afterParent.node_id) return null;
  const reason = input.reason?.trim() ?? "";
  return {
    event_id: crypto.randomUUID(),
    event_type: "problem_primary_parent_changed",
    timestamp: new Date().toISOString(),
    source: "manual_editor",
    file_path: projectRelativePath(input.filePath),
    content_id: input.contentId,
    anchor_text: input.anchorText,
    content_excerpt: contentExcerpt(input.sourceAfter),
    content_hash_before: hashContentSource(input.sourceBefore),
    content_hash_after: hashContentSource(input.sourceAfter),
    before: parentClassificationSnapshot({
      parentNodeId: input.beforeParent.node_id,
      parentName: input.beforeParent.name,
    }),
    after: parentClassificationSnapshot({
      parentNodeId: input.afterParent.node_id,
      parentName: input.afterParent.name,
    }),
    changed_fields: ["parent_node_id"],
    reason,
    reason_source: reason ? "user_provided" : "unspecified",
    active: true,
    supersedes_event_id:
      latestActiveForContent(input.contentId)?.event_id ?? null,
  } satisfies ClassificationCorrectionEvent;
}

export async function appendClassificationCorrectionEvent(
  event: ClassificationCorrectionEvent,
) {
  await fsp.mkdir(correctionsRoot, { recursive: true });
  const line = `${JSON.stringify(event)}\n`;
  const handle = await fsp.open(classificationLogPath, "a");
  try {
    await handle.writeFile(line, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function appendInvalidationEvent(input: {
  eventId: string;
  reason?: string;
}) {
  const { records } = getClassificationCorrectionRecords();
  const target = records.find(({ event }) => event.event_id === input.eventId);
  if (!target) throw new Error("找不到要标记失效的分类修正事件。");
  if (target.superseded || !target.event.active) {
    throw new Error("该事件已经失效或已被后续事件取代。");
  }
  const reason = input.reason?.trim() ?? "";
  const event: ClassificationCorrectionEvent = {
    ...target.event,
    event_id: crypto.randomUUID(),
    event_type: "invalidation",
    timestamp: new Date().toISOString(),
    content_hash_before: target.event.content_hash_after,
    content_hash_after: target.event.content_hash_after,
    changed_fields: [],
    reason,
    reason_source: reason ? "user_provided" : "unspecified",
    active: false,
    supersedes_event_id: target.event.event_id,
  };
  await appendClassificationCorrectionEvent(event);
  return event;
}

function searchTokens(text: string) {
  const normalized = text.toLowerCase();
  const tokens = new Set(
    normalized
      .split(/[^\p{L}\p{N}]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  );
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(sequence.slice(index, index + 2));
    }
  }
  return [...tokens];
}

export function findRelevantClassificationCorrections(input: {
  text?: string;
  currentModule?: string;
  targetModule?: string;
  currentParentNodeId?: string;
  targetParentNodeId?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const tokens = searchTokens(input.text ?? "");
  return getActiveClassificationCorrections()
    .map((record) => {
      const event = record.event;
      const haystack = [
        event.content_id,
        event.anchor_text,
        event.content_excerpt,
        event.file_path,
        event.reason,
      ]
        .join(" ")
        .toLowerCase();
      let score = tokens.reduce(
        (total, token) => total + (haystack.includes(token) ? 2 : 0),
        0,
      );
      if (input.currentModule && event.before.module === input.currentModule) {
        score += 4;
      }
      if (input.targetModule && event.after.module === input.targetModule) {
        score += 5;
      }
      if (
        input.currentParentNodeId &&
        event.before.parent_node_id === input.currentParentNodeId
      ) {
        score += 6;
      }
      if (
        input.targetParentNodeId &&
        event.after.parent_node_id === input.targetParentNodeId
      ) {
        score += 7;
      }
      return { ...record, score };
    })
    .filter((record) => record.score > 0 || (!tokens.length && !input.currentModule))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.event.timestamp.localeCompare(left.event.timestamp),
    )
    .slice(0, limit);
}

function escapeMarkdown(text: string) {
  return text.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
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

async function buildClassificationGuidanceLegacy() {
  const { records, errors } = getClassificationCorrectionRecords();
  const activeIds = new Set(
    getActiveClassificationCorrections().map(({ event }) => event.event_id),
  );
  const active = records.filter(({ event }) => activeIds.has(event.event_id));
  const correctionEvents = records.filter(
    ({ event }) =>
      isClassificationEvidenceEvent(event),
  );
  const invalid = correctionEvents.filter(
    ({ event, superseded }) => !event.active || superseded,
  ).length;
  const stale = correctionEvents.filter(
    ({ superseded, stale: isStale }) => !superseded && isStale,
  ).length;

  const migrations = new Map<string, number>();
  for (const { event } of active) {
    const beforeId = event.before.parent_node_id || event.before.module || "（空）";
    const afterId = event.after.parent_node_id || event.after.module || "（空）";
    if (beforeId === afterId) continue;
    const key = `${event.before.parent_name_snapshot || event.before.module || "（空）"} [${beforeId}] → ${event.after.parent_name_snapshot || event.after.module || "（空）"} [${afterId}]`;
    migrations.set(key, (migrations.get(key) ?? 0) + 1);
  }

  const byTarget = new Map<string, ClassificationCorrectionEvent[]>();
  for (const { event } of active) {
    const target = `${event.after.parent_name_snapshot || event.after.module || "（未指定容器）"}${event.after.parent_node_id ? ` [${event.after.parent_node_id}]` : ""}`;
    const items = byTarget.get(target) ?? [];
    items.push(event);
    byTarget.set(target, items);
  }

  const targetSets = new Map<string, Set<string>>();
  for (const { event } of active) {
    const key = `${event.content_id}|${event.content_excerpt.slice(0, 80)}`;
    const targets = targetSets.get(key) ?? new Set<string>();
    targets.add(event.after.parent_node_id || event.after.module);
    targetSets.set(key, targets);
  }
  const conflicts = [...targetSets.entries()].filter(
    ([, targets]) => targets.size > 1,
  );

  const lines = [
    "# 物理分类人工修正经验",
    "",
    `- 最近生成时间：${new Date().toISOString()}`,
    `- 当前有效且内容哈希一致的案例：${active.length}`,
    `- 已失效或被后续事件取代：${invalid}`,
    `- 内容哈希已变化：${stale}`,
    `- 日志格式错误：${errors.length}`,
    "",
    "> 本文件是分类任务的简短入口。人工案例是用户偏好的证据，不是不可违背的通用规则。",
    "",
    "## 常见模块迁移",
    "",
  ];

  const sortedMigrations = [...migrations.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12);
  if (!sortedMigrations.length) {
    lines.push("- 暂无有效的跨模块迁移案例。");
  } else {
    for (const [migration, count] of sortedMigrations) {
      const level = count >= 3 ? "候选规律" : "参考案例";
      lines.push(`- ${migration}：${count} 次（${level}）`);
    }
  }

  lines.push("", "## 按目标模块的代表案例", "");
  for (const [moduleName, events] of [...byTarget.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 10)) {
    lines.push(`### ${moduleName}`, "");
    for (const event of events.slice(0, 3)) {
      const reason = event.reason ? `；理由：${escapeMarkdown(event.reason)}` : "";
      lines.push(
        `- ${event.content_id || event.anchor_text}：${escapeMarkdown(event.content_excerpt.slice(0, 140))}${reason}`,
      );
    }
    lines.push("");
  }
  if (!byTarget.size) lines.push("- 暂无代表案例。", "");

  lines.push("## 冲突与样本限制", "");
  if (conflicts.length) {
    for (const [key, targets] of conflicts.slice(0, 8)) {
      lines.push(
        `- 冲突案例：${escapeMarkdown(key.split("|")[0])} 曾指向 ${[...targets].join("、")}。`,
      );
    }
  } else {
    lines.push("- 当前有效案例中未检测到同一内容指向多个目标模块的冲突。");
  }
  lines.push(
    "- 一至两个语义一致案例仅作为参考；至少三次重复且方向一致时才标为候选规律。",
    "- 候选规律不会自动升级为强制规则；相似度弱或案例冲突时应标低信度并人工确认。",
    "",
  );

  const guidance = `${lines.slice(0, 120).join("\n")}\n`;
  await writeAtomic(classificationGuidancePath, guidance);
  return {
    active: active.length,
    invalid,
    stale,
    errors: errors.length,
    guidance,
  };
}

export async function buildClassificationGuidance() {
  const { records, errors } = getClassificationCorrectionRecords();
  const activeIds = new Set(
    getActiveClassificationCorrections().map(({ event }) => event.event_id),
  );
  const active = records
    .filter(({ event }) => activeIds.has(event.event_id))
    .map(({ event }) => event);
  const correctionEvents = records.filter(({ event }) =>
    isClassificationEvidenceEvent(event),
  );
  const invalid = correctionEvents.filter(
    ({ event, superseded }) => !event.active || superseded,
  ).length;
  const stale = correctionEvents.filter(
    ({ superseded, stale: isStale }) => !superseded && isStale,
  ).length;

  const migrationCounts = new Map<
    string,
    { count: number; before: string; after: string; examples: ClassificationCorrectionEvent[] }
  >();
  for (const event of active) {
    const beforeId = event.before.parent_node_id || event.before.module || "(unknown)";
    const afterId = event.after.parent_node_id || event.after.module || "(unknown)";
    if (beforeId === afterId) continue;
    const before = `${event.before.parent_name_snapshot || event.before.module || "未指定"} [${beforeId}]`;
    const after = `${event.after.parent_name_snapshot || event.after.module || "未指定"} [${afterId}]`;
    const key = `${before} -> ${after}`;
    const entry =
      migrationCounts.get(key) ?? { count: 0, before, after, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3) entry.examples.push(event);
    migrationCounts.set(key, entry);
  }

  const byTarget = new Map<string, ClassificationCorrectionEvent[]>();
  for (const event of active) {
    const target = `${event.after.parent_name_snapshot || event.after.module || "未指定"}${
      event.after.parent_node_id ? ` [${event.after.parent_node_id}]` : ""
    }`;
    const items = byTarget.get(target) ?? [];
    items.push(event);
    byTarget.set(target, items);
  }

  const targetSets = new Map<string, Set<string>>();
  for (const event of active) {
    const key = `${event.content_id || event.anchor_text}|${event.content_excerpt.slice(0, 80)}`;
    const targets = targetSets.get(key) ?? new Set<string>();
    targets.add(event.after.parent_node_id || event.after.module || "unknown");
    targetSets.set(key, targets);
  }
  const conflicts = [...targetSets.entries()].filter(
    ([, targets]) => targets.size > 1,
  );

  const lines = [
    "# 物理分类人工修正经验摘要",
    "",
    `- 最近生成时间：${new Date().toISOString()}`,
    `- 当前有效案例：${active.length}`,
    `- 已失效或被后续事件取代：${invalid}`,
    `- 内容哈希已变化：${stale}`,
    `- 日志格式错误：${errors.length}`,
    "",
    "> 本文件用于阶段B分类建议上下文。它是人工案例摘要，不是模型训练结果，也不是强制规则。",
    "",
    "## 常见迁移方向",
    "",
  ];

  const migrations = [...migrationCounts.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);
  if (!migrations.length) {
    lines.push("- 暂无有效的分类迁移案例。");
  } else {
    for (const migration of migrations) {
      const strength = migration.count >= 3 ? "候选规律" : "参考案例";
      lines.push(
        `- ${migration.before} -> ${migration.after}：${migration.count}次（${strength}）`,
      );
    }
  }

  lines.push("", "## 按目标节点整理的代表案例", "");
  for (const [target, events] of [...byTarget.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 8)) {
    lines.push(`### ${target}`, "");
    for (const event of events.slice(0, 2)) {
      const reason = event.reason
        ? `；人工理由：${escapeMarkdown(event.reason).slice(0, 80)}`
        : "";
      lines.push(
        `- ${event.content_id || event.anchor_text}：${escapeMarkdown(
          event.content_excerpt.slice(0, 140),
        )}${reason}`,
      );
    }
    lines.push("");
  }
  if (!byTarget.size) lines.push("- 暂无代表案例。", "");

  lines.push("## 容易混淆与不确定性", "");
  if (conflicts.length) {
    for (const [key, targets] of conflicts.slice(0, 6)) {
      lines.push(
        `- 冲突案例：${escapeMarkdown(key.split("|")[0])} 曾指向 ${[
          ...targets,
        ].join("、")}。`,
      );
    }
  } else {
    lines.push("- 当前有效案例中未检测到同一内容指向多个目标节点的冲突。");
  }
  lines.push(
    "- 1至2个方向一致的案例只能作为参考；至少3次重复且语义一致时才标为候选规律。",
    "- 候选规律不会自动升级为强制规则；相似度弱、样本不足或案例冲突时，应给低置信度并等待人工确认。",
    "- 接受AI建议前必须经过网页确认和现有图移动预览，不允许自动改图。",
    "",
  );

  const guidance = `${lines.slice(0, 120).join("\n")}\n`;
  await writeAtomic(classificationGuidancePath, guidance);
  return {
    active: active.length,
    invalid,
    stale,
    errors: errors.length,
    guidance,
  };
}
