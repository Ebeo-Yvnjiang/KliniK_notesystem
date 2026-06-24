import { revalidatePath } from "next/cache";
import {
  appendInvalidationEvent,
  buildClassificationGuidance,
} from "@/lib/classification-corrections";

export const runtime = "nodejs";

function isLocalRequest(request: Request) {
  const host = request.headers.get("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return Response.json(
      { ok: false, error: "分类修正接口只允许从本机 localhost 访问。" },
      { status: 403 },
    );
  }

  try {
    const payload = (await request.json()) as {
      action?: unknown;
      eventId?: unknown;
      reason?: unknown;
    };
    if (payload.action !== "invalidate") {
      throw new Error("不支持的审计操作。");
    }
    if (typeof payload.eventId !== "string" || !payload.eventId) {
      throw new Error("缺少要标记失效的事件 ID。");
    }
    const event = await appendInvalidationEvent({
      eventId: payload.eventId,
      reason:
        typeof payload.reason === "string"
          ? payload.reason.slice(0, 1000)
          : "",
    });

    let warning = "";
    try {
      await buildClassificationGuidance();
    } catch (error) {
      warning = `失效事件已保存，但经验摘要刷新失败：${
        error instanceof Error ? error.message : String(error)
      }`;
    }
    revalidatePath("/review/classification-corrections");
    return Response.json({
      ok: true,
      eventId: event.event_id,
      warning: warning || undefined,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "审计操作失败。",
      },
      { status: 400 },
    );
  }
}
