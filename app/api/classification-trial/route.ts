import {
  buildUnclassifiedClassificationTaskPackage,
  importAiClassificationSuggestions,
  readPendingSuggestionStore,
  recordSuggestionDecision,
} from "@/lib/classification-trial";

export const runtime = "nodejs";

function localOnly(request: Request) {
  const host = request.headers.get("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

export async function GET(request: Request) {
  if (!localOnly(request)) {
    return Response.json(
      { ok: false, error: "阶段B分类试运行接口只允许从本机 localhost 访问。" },
      { status: 403 },
    );
  }
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "10");
  try {
    const taskPackage = buildUnclassifiedClassificationTaskPackage({
      limit: Number.isFinite(limit) ? limit : 10,
    });
    return Response.json({
      ok: true,
      taskPackage,
      pending: readPendingSuggestionStore(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "导出分类任务包失败。",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (!localOnly(request)) {
    return Response.json(
      { ok: false, error: "阶段B分类试运行接口只允许从本机 localhost 访问。" },
      { status: 403 },
    );
  }
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      suggestions?: unknown;
      suggestionId?: unknown;
      status?: unknown;
      finalParentNodeId?: unknown;
      reason?: unknown;
      graphEventId?: unknown;
    };
    if (body.mode === "import") {
      const result = await importAiClassificationSuggestions(body.suggestions);
      return Response.json({
        ok: true,
        ...result,
        pending: readPendingSuggestionStore(),
      });
    }
    if (body.mode === "decision") {
      if (typeof body.suggestionId !== "string") {
        throw new Error("缺少 suggestionId。");
      }
      if (
        body.status !== "accepted" &&
        body.status !== "overridden" &&
        body.status !== "rejected" &&
        body.status !== "skipped"
      ) {
        throw new Error("无效的建议处理状态。");
      }
      const record = await recordSuggestionDecision({
        suggestionId: body.suggestionId,
        status: body.status,
        finalParentNodeId:
          typeof body.finalParentNodeId === "string"
            ? body.finalParentNodeId
            : undefined,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        graphEventId:
          typeof body.graphEventId === "string" ? body.graphEventId : undefined,
      });
      return Response.json({
        ok: true,
        record,
        pending: readPendingSuggestionStore(),
      });
    }
    throw new Error("未知阶段B分类试运行操作。");
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "阶段B分类试运行操作失败。",
      },
      { status: 400 },
    );
  }
}
