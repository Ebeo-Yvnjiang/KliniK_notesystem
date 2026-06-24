import { revalidatePath } from "next/cache";
import {
  executeGraphAction,
  GraphVersionConflictError,
  previewGraphAction,
  type GraphAction,
} from "@/lib/graph/operations";
import { getGraphVersion } from "@/lib/graph/store";

export const runtime = "nodejs";

function localOnly(request: Request) {
  const host = request.headers.get("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

export async function POST(request: Request) {
  if (!localOnly(request)) {
    return Response.json(
      { ok: false, error: "图管理接口只允许从本机 localhost 访问。" },
      { status: 403 },
    );
  }
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      action?: unknown;
      payload?: unknown;
      graphVersion?: unknown;
    };
    if (
      typeof body.action !== "string" ||
      ![
        "create",
        "create_content",
        "change_purpose",
        "rename",
        "move",
        "bulk_move",
        "reorder",
        "reorder_siblings",
        "archive",
        "restore",
        "delete_empty",
        "merge",
        "rekey",
        "create_edge",
        "delete_edge",
        "change_permission",
      ].includes(body.action)
    ) {
      throw new Error("未知图管理操作。");
    }
    const action = body.action as GraphAction;
    const payload =
      body.payload && typeof body.payload === "object"
        ? (body.payload as Record<string, unknown>)
        : {};
    if (typeof body.graphVersion !== "string" || !body.graphVersion) {
      return Response.json(
        { ok: false, error: "缺少图版本，请重新加载管理页面。" },
        { status: 409 },
      );
    }
    if (body.mode === "preview") {
      if (body.graphVersion !== getGraphVersion()) {
        return Response.json(
          { ok: false, error: "图数据已变化，请重新加载后再预览。" },
          { status: 409 },
        );
      }
      return Response.json({
        ok: true,
        preview: previewGraphAction(action, payload),
        graphVersion: getGraphVersion(),
      });
    }
    if (body.mode !== "commit") {
      throw new Error("管理操作必须先预览，再明确提交。");
    }
    const result = await executeGraphAction(
      action,
      payload,
      "admin_ui",
      body.graphVersion,
    );
    try {
      revalidatePath("/nodes", "layout");
      revalidatePath("/admin/nodes");
      revalidatePath("/physics");
      revalidatePath("/problems");
      revalidatePath("/review/classification-corrections");
      revalidatePath("/admin/classification-trial");
    } catch {
      // 数据已提交；页面可手动刷新。
    }
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "图管理操作失败。",
      },
      { status: error instanceof GraphVersionConflictError ? 409 : 400 },
    );
  }
}
