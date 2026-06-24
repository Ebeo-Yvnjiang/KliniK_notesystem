"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InvalidateCorrectionButton({
  eventId,
}: {
  eventId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function invalidate() {
    const reason =
      window.prompt("失效依据（可选；留空不会自动生成理由）", "") ?? null;
    if (reason === null) return;
    if (!window.confirm("确认追加一条失效事件？旧记录会保留在审计历史中。")) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classification-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invalidate",
          eventId,
          reason,
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        warning?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "标记失效失败。");
      }
      setMessage(result.warning ?? "已追加失效事件。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "标记失效失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="correction-action">
      <button disabled={busy} onClick={invalidate} type="button">
        {busy ? "处理中…" : "标记失效"}
      </button>
      {message && <small>{message}</small>}
    </div>
  );
}
