import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { revalidatePath } from "next/cache";
import { buildClassificationGuidance } from "@/lib/classification-corrections";
import { contentVersion } from "@/lib/graph/content-version";
import { rebuildDerivedIndexes } from "@/lib/graph/derived";
import { recordManualOverrideHash } from "@/lib/graph/manual-override";
import { executeGraphAction } from "@/lib/graph/operations";
import { readGraphData } from "@/lib/graph/store";
import {
  resolveEditableTarget,
  type EditableTarget,
} from "@/lib/private-content-paths";

export const runtime = "nodejs";

const commonFields = [
  "node_id",
  "primary_parent_id",
  "subject",
  "module",
  "visibility",
  "status",
  "classification_status",
  "content_type",
  "manual_override",
  "last_manual_edit_at",
] as const;

const problemFields = new Set([
  ...commonFields,
  "id",
  "anchor_type",
  "anchor_text",
  "submodule",
  "source",
  "source_note",
  "analysis_state",
  "needs_ai_analysis",
  "has_original_analysis",
  "difficulty",
  "review_priority",
  "error_type",
  "knowledge_points",
  "worth_public_rewrite",
  "boundary_confidence",
  "classification_confidence",
]);
const summaryFields = new Set(commonFields);

function validateTarget(value: unknown): EditableTarget {
  if (!value || typeof value !== "object") throw new Error("缺少编辑目标。");
  const target = value as Record<string, unknown>;
  if (
    target.kind !== "node" ||
    typeof target.id !== "string" ||
    !/^\d{8}$/.test(target.id)
  ) {
    throw new Error("编辑目标必须使用8位 node_id。");
  }
  return { kind: "node", id: target.id };
}

async function atomicWrite(filePath: string, content: string) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
  const backupPath = `${filePath}.${crypto.randomUUID()}.bak`;
  try {
    await fs.rename(filePath, backupPath);
    try {
      await fs.rename(tempPath, filePath);
      await fs.rm(backupPath, { force: true });
    } catch (error) {
      await fs.rename(backupPath, filePath).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const host = request.headers.get("host") ?? "";
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) {
      return Response.json(
        { ok: false, error: "编辑接口只允许从本机 localhost 访问。" },
        { status: 403 },
      );
    }
    const payload = (await request.json()) as {
      target?: unknown;
      source?: unknown;
      baseHash?: unknown;
      desiredParentId?: unknown;
      classificationReason?: unknown;
    };
    const target = validateTarget(payload.target);
    if (typeof payload.source !== "string" || payload.source.length > 2_000_000) {
      throw new Error("内容为空或超过2 MB限制。");
    }
    if (typeof payload.baseHash !== "string") {
      throw new Error("缺少并发保存版本号，请重新加载页面。");
    }
    if (!payload.source.startsWith("---")) {
      throw new Error("内容必须以 YAML frontmatter 开头。");
    }

    const { filePath, node } = resolveEditableTarget(target);
    const graphBefore = readGraphData();
    const parentBefore = node.primary_parent_id
      ? graphBefore.nodes.find(
          (item) => item.node_id === node.primary_parent_id,
        )
      : null;
    const currentSource = await fs.readFile(filePath, "utf8");
    if (contentVersion(currentSource) !== payload.baseHash) {
      return Response.json(
        {
          ok: false,
          conflict: true,
          error: "文件已被其他操作修改。请重新加载后比较差异，当前保存未执行。",
        },
        { status: 409 },
      );
    }

    const current = matter(currentSource);
    const parsed = matter(payload.source);
    const contentTemplate = String(node.metadata?.content_template ?? "");
    const allowed =
      ["problem_note", "unassigned_fragments"].includes(node.content_type) ||
      ["problem_note", "unassigned_fragments"].includes(contentTemplate)
      ? problemFields
      : summaryFields;
    const unknownFields = Object.keys(parsed.data).filter(
      (key) => !allowed.has(key),
    );
    if (unknownFields.length) {
      throw new Error(`不允许的 frontmatter 字段：${unknownFields.join("、")}`);
    }
    if (parsed.data.subject !== "physics" || parsed.data.visibility !== "private") {
      throw new Error("subject必须为physics，visibility必须为private。");
    }
    if (String(parsed.data.node_id) !== node.node_id) {
      throw new Error("不允许通过正文编辑器修改 node_id。");
    }
    if (String(parsed.data.primary_parent_id) !== String(node.primary_parent_id)) {
      throw new Error("主要归属必须通过容器选择器或管理页面修改。");
    }
    if (
      parsed.data.content_type !== undefined &&
      String(parsed.data.content_type) !== node.content_type
    ) {
      throw new Error("节点用途必须通过节点管理页的受控用途变更操作修改。");
    }
    if (
      parentBefore &&
      parsed.data.module !== undefined &&
      String(parsed.data.module) !== parentBefore.name
    ) {
      throw new Error("module是兼容显示快照，不能直接作为分类主键修改。");
    }
    if (
      (["problem_note", "unassigned_fragments"].includes(node.content_type) ||
        ["problem_note", "unassigned_fragments"].includes(contentTemplate)) &&
      parsed.data.id !== current.data.id
    ) {
      throw new Error("不允许修改题目外部ID/旧卡片ID。");
    }

    parsed.data.manual_override = true;
    parsed.data.last_manual_edit_at = new Date().toISOString();
    const savedSource = matter.stringify(parsed.content, parsed.data);
    await atomicWrite(filePath, savedSource);

    let finalSource = savedSource;
    let moveResult:
      | Awaited<ReturnType<typeof executeGraphAction>>
      | undefined;
    try {
      if (
        typeof payload.desiredParentId === "string" &&
        payload.desiredParentId !== node.primary_parent_id
      ) {
        moveResult = await executeGraphAction(
          "move",
          {
            node_id: node.node_id,
            target_parent_id: payload.desiredParentId,
            classification_evidence: node.content_type === "problem_note",
            reason:
              typeof payload.classificationReason === "string"
                ? payload.classificationReason.slice(0, 1000)
                : "",
          },
          "manual_editor",
        );
        finalSource = await fs.readFile(filePath, "utf8");
      } else {
        await rebuildDerivedIndexes(readGraphData());
        if (
          current.data.classification_status !==
            parsed.data.classification_status ||
          current.data.classification_confidence !==
            parsed.data.classification_confidence ||
          current.data.content_type !== parsed.data.content_type
        ) {
          await buildClassificationGuidance();
        }
      }
    } catch (error) {
      await atomicWrite(filePath, currentSource).catch(() => undefined);
      await rebuildDerivedIndexes(readGraphData()).catch(() => undefined);
      throw error;
    }

    try {
      revalidatePath(`/nodes/${node.node_id}`);
      revalidatePath("/nodes", "layout");
      revalidatePath("/physics");
      revalidatePath("/problems");
      revalidatePath("/inbox");
      revalidatePath("/review/classification-corrections");
    } catch {
      // 文件和图数据已经提交；开发服务器通常会在下一次请求时刷新。
    }

    const graphAfter = readGraphData();
    const updatedNode = graphAfter.nodes.find(
      (item) => item.node_id === node.node_id,
    );
    await recordManualOverrideHash(node.content_path!, finalSource);
    return Response.json({
      ok: true,
      source: finalSource,
      version: contentVersion(finalSource),
      primaryParentId: updatedNode?.primary_parent_id ?? node.primary_parent_id,
      classificationCorrection: moveResult?.classificationEventId
        ? {
            logged: true,
            eventId: moveResult.classificationEventId,
            guidanceRefreshed: !moveResult.warning,
          }
        : { logged: false, guidanceRefreshed: false },
      warning: moveResult?.warning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败。";
    const status =
      message.includes("不存在") || message.includes("找不到") ? 404 : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}
