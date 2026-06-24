import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { rebuildDerivedIndexes } from "./derived.ts";
import {
  graphAuditPath,
  graphBackupsRoot,
  graphWriteLockPath,
  idStatePath,
  projectRoot,
} from "./paths.ts";
import { getGraphVersion, readGraphData } from "./store.ts";
import { assertGraphValid } from "./validation.ts";
import type { GraphAuditEvent, GraphIdState } from "./types.ts";

const allowedRestorePrefixes = [
  "data/graph/",
  "data/indexes/",
  "data/corrections/",
  "content/private/",
];

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(item)));
    else result.push(item);
  }
  return result;
}

async function exists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function normalizeRelative(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (
    normalized.includes("../") ||
    !allowedRestorePrefixes.some((prefix) => normalized.startsWith(prefix))
  ) {
    throw new Error(`备份包含不允许恢复的路径：${value}`);
  }
  return normalized;
}

async function hashFile(filePath: string) {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
}

export type GraphBackupItem = {
  backupPath: string;
  createdAt: string;
  category: "migration" | "operation" | "test" | "restore_safety";
  sourceOperation: string;
  fileCount: number;
  restorable: boolean;
  retention: "keep" | "recent" | "test_candidate" | "cleanup_candidate";
};

export async function listGraphBackups(): Promise<GraphBackupItem[]> {
  const auditLines = (await fs.readFile(graphAuditPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as GraphAuditEvent & { test_event?: boolean };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as (GraphAuditEvent & { test_event?: boolean })[];
  const auditByBackup = new Map(
    auditLines
      .filter((event) => event.backup_path)
      .map((event) => [event.backup_path!, event]),
  );
  const directories: string[] = [];
  if (await exists(graphBackupsRoot)) {
    for (const entry of await fs.readdir(graphBackupsRoot, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) directories.push(path.join(graphBackupsRoot, entry.name));
    }
  }
  for (const entry of await fs.readdir(path.join(projectRoot, "data", "backups"), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory() && entry.name.startsWith("graph-migration-")) {
      directories.push(path.join(projectRoot, "data", "backups", entry.name));
    }
  }
  const items = await Promise.all(
    directories.map(async (directory) => {
      const relative = path.relative(projectRoot, directory).replaceAll("\\", "/");
      const files = await walk(directory);
      const event = auditByBackup.get(relative);
      const migration = path.basename(directory).startsWith("graph-migration-");
      const restoreSafety = path.basename(directory).includes("restore-safety");
      const test =
        Boolean(event?.test_event) ||
        JSON.stringify(event?.before ?? "").includes("__验收") ||
        JSON.stringify(event?.before ?? "").includes("__测试");
      const category = migration
        ? "migration"
        : restoreSafety
          ? "restore_safety"
          : test
            ? "test"
            : "operation";
      const stat = await fs.stat(directory);
      const restorable =
        files.some((file) =>
          file.endsWith(path.join("data", "graph", "nodes.json")),
        ) &&
        files.some((file) =>
          file.endsWith(path.join("data", "graph", "edges.json")),
        );
      return {
        backupPath: relative,
        createdAt: stat.birthtime.toISOString(),
        category,
        sourceOperation: event?.event_type ?? (migration ? "migration" : "unknown"),
        fileCount: files.length,
        restorable,
        retention:
          category === "migration"
            ? "keep"
            : category === "test"
              ? "test_candidate"
              : "recent",
      } satisfies GraphBackupItem;
    }),
  );
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function resolveBackupPath(relative: string) {
  const resolved = path.resolve(projectRoot, relative);
  const roots = [
    path.resolve(graphBackupsRoot),
    path.resolve(projectRoot, "data", "backups"),
  ];
  if (
    !roots.some(
      (root) => resolved.startsWith(`${root}${path.sep}`) && resolved !== root,
    )
  ) {
    throw new Error("备份路径不在项目备份白名单中。");
  }
  return resolved;
}

export async function previewGraphBackupRestore(backupPath: string) {
  const directory = resolveBackupPath(backupPath);
  const files = await walk(directory);
  const changes: {
    path: string;
    state: "changed" | "missing_current" | "same";
  }[] = [];
  for (const file of files) {
    const relative = normalizeRelative(path.relative(directory, file));
    if (relative === "data/graph/id-state.json") continue;
    const current = path.resolve(projectRoot, relative);
    const state = !(await exists(current))
      ? "missing_current"
      : (await hashFile(file)) === (await hashFile(current))
        ? "same"
        : "changed";
    changes.push({ path: relative, state });
  }
  if (!changes.some((item) => item.path === "data/graph/nodes.json")) {
    throw new Error("该备份不是可恢复的图快照。");
  }
  return {
    backupPath,
    fileCount: files.length,
    changedFiles: changes.filter((item) => item.state !== "same"),
    unchangedFiles: changes.filter((item) => item.state === "same").length,
  };
}

async function writeAtomic(filePath: string, content: Buffer | string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, content);
  try {
    await fs.rename(temp, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(temp, filePath);
  }
}

async function acquireLock() {
  try {
    return await fs.open(graphWriteLockPath, "wx");
  } catch {
    throw new Error("图数据正被其他管理操作修改，请稍后重试。");
  }
}

export class BackupRestoreConflictError extends Error {}

export async function restoreGraphBackup(
  backupPath: string,
  expectedGraphVersion: string,
  source: "admin_ui" | "test" = "admin_ui",
) {
  const lock = await acquireLock();
  let safetyPath = "";
  try {
    if (getGraphVersion() !== expectedGraphVersion) {
      throw new BackupRestoreConflictError(
        "图数据已变化，请重新加载备份预览。",
      );
    }
    const preview = await previewGraphBackupRestore(backupPath);
    const backupDirectory = resolveBackupPath(backupPath);
    const restoreFiles = (await walk(backupDirectory))
      .map((file) => ({
        source: file,
        relative: normalizeRelative(path.relative(backupDirectory, file)),
      }))
      .filter((item) => item.relative !== "data/graph/id-state.json");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safetyDirectory = path.join(
      graphBackupsRoot,
      `${stamp}-restore-safety-${crypto.randomUUID().slice(0, 8)}`,
    );
    safetyPath = path.relative(projectRoot, safetyDirectory).replaceAll("\\", "/");
    for (const item of restoreFiles) {
      const current = path.resolve(projectRoot, item.relative);
      if (!(await exists(current))) continue;
      const target = path.join(safetyDirectory, item.relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(current, target);
    }
    const currentIdState = JSON.parse(
      await fs.readFile(idStatePath, "utf8"),
    ) as GraphIdState;
    const createdTargets: string[] = [];
    try {
      for (const item of restoreFiles) {
        const target = path.resolve(projectRoot, item.relative);
        if (!(await exists(target))) createdTargets.push(target);
        await writeAtomic(
          target,
          await fs.readFile(item.source),
        );
      }
      const restored = readGraphData();
      const activeNodeIds = new Set(restored.nodes.map((node) => node.node_id));
      const activeEdgeIds = new Set(restored.edges.map((edge) => edge.edge_id));
      currentIdState.retired_node_ids =
        currentIdState.retired_node_ids.filter((id) => !activeNodeIds.has(id));
      currentIdState.retired_edge_ids =
        currentIdState.retired_edge_ids.filter((id) => !activeEdgeIds.has(id));
      currentIdState.updated_at = new Date().toISOString();
      await writeAtomic(
        idStatePath,
        `${JSON.stringify(currentIdState, null, 2)}\n`,
      );
      assertGraphValid(restored);
      await rebuildDerivedIndexes(restored);
      const check = spawnSync(
        process.execPath,
        ["--no-warnings", "scripts/check-graph-consistency.ts"],
        { cwd: projectRoot, encoding: "utf8" },
      );
      if (check.status !== 0) {
        throw new Error(check.stderr || check.stdout || "恢复后图检查失败。");
      }
    } catch (error) {
      for (const target of createdTargets) {
        await fs.rm(target, { force: true }).catch(() => undefined);
      }
      const safetyFiles = await walk(safetyDirectory);
      for (const file of safetyFiles) {
        const relative = normalizeRelative(path.relative(safetyDirectory, file));
        await writeAtomic(path.resolve(projectRoot, relative), await fs.readFile(file));
      }
      await writeAtomic(
        idStatePath,
        `${JSON.stringify(currentIdState, null, 2)}\n`,
      );
      throw error;
    }
    const event: GraphAuditEvent & {
      restored_backup_path: string;
      test_event: boolean;
    } = {
      event_id: crypto.randomUUID(),
      event_type: "backup_restored",
      timestamp: new Date().toISOString(),
      source,
      success: true,
      actor: "local_admin",
      node_ids: [],
      edge_ids: [],
      before: preview,
      after: { restored_backup_path: backupPath },
      impact: { changed_files: preview.changedFiles.map((item) => item.path) },
      backup_path: safetyPath,
      restored_backup_path: backupPath,
      reason: "管理员备份恢复",
      failure_reason: null,
      classification_evidence: false,
      test_event: source === "test",
      active: source !== "test",
    };
    await fs.appendFile(graphAuditPath, `${JSON.stringify(event)}\n`, "utf8");
    return {
      ok: true,
      preview,
      safetyBackupPath: safetyPath,
      graphVersion: getGraphVersion(),
    };
  } finally {
    await lock.close();
    await fs.rm(graphWriteLockPath, { force: true });
  }
}
