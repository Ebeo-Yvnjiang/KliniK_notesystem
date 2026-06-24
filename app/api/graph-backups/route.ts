import { revalidatePath } from "next/cache";
import {
  BackupRestoreConflictError,
  listGraphBackups,
  previewGraphBackupRestore,
  restoreGraphBackup,
} from "@/lib/graph/backups";
import { getGraphVersion } from "@/lib/graph/store";

export const runtime = "nodejs";

function localOnly(request: Request) {
  const host = request.headers.get("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

export async function GET(request: Request) {
  if (!localOnly(request)) {
    return Response.json({ ok: false, error: "仅允许本机访问。" }, { status: 403 });
  }
  return Response.json({
    ok: true,
    backups: await listGraphBackups(),
    graphVersion: getGraphVersion(),
  });
}

export async function POST(request: Request) {
  if (!localOnly(request)) {
    return Response.json({ ok: false, error: "仅允许本机访问。" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      backupPath?: unknown;
      graphVersion?: unknown;
    };
    if (typeof body.backupPath !== "string" || !body.backupPath) {
      throw new Error("缺少备份路径。");
    }
    if (typeof body.graphVersion !== "string" || !body.graphVersion) {
      return Response.json(
        { ok: false, error: "缺少图版本，请重新加载。" },
        { status: 409 },
      );
    }
    if (body.graphVersion !== getGraphVersion()) {
      return Response.json(
        { ok: false, error: "图数据已变化，请重新加载备份列表。" },
        { status: 409 },
      );
    }
    if (body.mode === "preview") {
      return Response.json({
        ok: true,
        preview: await previewGraphBackupRestore(body.backupPath),
        graphVersion: getGraphVersion(),
      });
    }
    if (body.mode !== "commit") throw new Error("必须先预览再恢复。");
    const result = await restoreGraphBackup(body.backupPath, body.graphVersion);
    revalidatePath("/admin/nodes");
    revalidatePath("/nodes", "layout");
    revalidatePath("/physics");
    revalidatePath("/problems");
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "备份恢复失败。",
      },
      { status: error instanceof BackupRestoreConflictError ? 409 : 400 },
    );
  }
}
