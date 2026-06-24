"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NodeCombobox } from "@/components/node-combobox";
import type {
  ClassificationTarget,
  ClassificationTaskPackage,
  PendingSuggestionStore,
} from "@/lib/classification-trial";

type Props = {
  initialTaskPackage: ClassificationTaskPackage;
  initialPending: PendingSuggestionStore;
  graphVersion: string;
};

export function ClassificationTrialPanel({
  initialTaskPackage,
  initialPending,
  graphVersion: initialGraphVersion,
}: Props) {
  const router = useRouter();
  const [taskPackage, setTaskPackage] = useState(initialTaskPackage);
  const [pending, setPending] = useState(initialPending);
  const [graphVersion, setGraphVersion] = useState(initialGraphVersion);
  const [importText, setImportText] = useState("");
  const [message, setMessage] = useState("");
  const [limit, setLimit] = useState(String(initialTaskPackage.items.length || 10));

  const targetItems = useMemo(
    () =>
      taskPackage.target_parent_nodes.map((node) => ({
        node_id: node.node_id,
        name: node.name,
        path: node.path,
        status: "active",
        unavailable_reason: "",
      })),
    [taskPackage.target_parent_nodes],
  );

  async function refreshPackage() {
    setMessage("");
    const response = await fetch(`/api/classification-trial?limit=${encodeURIComponent(limit)}`);
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "导出任务包失败。");
      return;
    }
    setTaskPackage(result.taskPackage);
    setPending(result.pending);
    setMessage("任务包已重新生成。");
  }

  async function importSuggestions() {
    setMessage("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setMessage("导入内容不是有效 JSON。");
      return;
    }
    const response = await fetch("/api/classification-trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "import", suggestions: parsed }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "导入建议失败。");
      return;
    }
    setPending(result.pending);
    setMessage(
      `已导入 ${result.imported} 条建议。${
        result.errors?.length ? `有 ${result.errors.length} 条被拒绝。` : ""
      }`,
    );
  }

  async function recordDecision(input: {
    suggestionId: string;
    status: "accepted" | "overridden" | "rejected" | "skipped";
    finalParentNodeId?: string;
    reason?: string;
    graphEventId?: string;
  }) {
    const response = await fetch("/api/classification-trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "decision",
        suggestionId: input.suggestionId,
        status: input.status,
        finalParentNodeId: input.finalParentNodeId,
        reason: input.reason,
        graphEventId: input.graphEventId,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "记录建议处理结果失败。");
      return false;
    }
    setPending(result.pending);
    return true;
  }

  async function handleMove(input: {
    suggestionId: string;
    nodeId: string;
    targetParentId: string;
    status: "accepted" | "overridden";
    reason: string;
  }) {
    setMessage("");
    const payload = {
      node_id: input.nodeId,
      target_parent_id: input.targetParentId,
      classification_evidence: true,
      reason: input.reason,
    };
    const previewResponse = await fetch("/api/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "preview",
        action: "move",
        payload,
        graphVersion,
      }),
    });
    const previewResult = await previewResponse.json();
    if (!previewResponse.ok || !previewResult.ok) {
      setMessage(previewResult.error ?? "移动预览失败。");
      return;
    }
    if (
      !window.confirm(
        `确认按这条建议移动节点？\n\n${JSON.stringify(previewResult.preview, null, 2)}`,
      )
    ) {
      return;
    }
    const commitResponse = await fetch("/api/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "commit",
        action: "move",
        payload,
        graphVersion: previewResult.graphVersion,
      }),
    });
    const commitResult = await commitResponse.json();
    if (!commitResponse.ok || !commitResult.ok) {
      setMessage(
        commitResponse.status === 409
          ? `${commitResult.error ?? "图版本冲突。"} 请刷新后重试。`
          : commitResult.error ?? "移动提交失败。",
      );
      return;
    }
    setGraphVersion(commitResult.graphVersion);
    const recorded = await recordDecision({
      suggestionId: input.suggestionId,
      status: input.status,
      finalParentNodeId: input.targetParentId,
      reason: input.reason,
      graphEventId: commitResult.event?.event_id,
    });
    if (recorded) {
      setMessage(
        `节点已移动；备份：${commitResult.backupPath ?? "无"}${
          commitResult.warning ? `；${commitResult.warning}` : ""
        }`,
      );
      router.refresh();
    }
  }

  const pendingRecords = pending.records.filter((record) => record.status === "pending");

  function targetLabel(targetId: string) {
    const target = taskPackage.target_parent_nodes.find(
      (node) => node.node_id === targetId,
    );
    return target ? `${target.name} · ${target.node_id}` : targetId;
  }

  return (
    <div className="stage-b-grid">
      {message && <p className="editor-message">{message}</p>}
      <section className="stage-b-card">
        <h2>1. 导出未分类题目任务包</h2>
        <p>
          任务包只用于给外部 AI/Codex 提供上下文；它不会自动修改图数据。
        </p>
        <label>
          导出数量
          <input
            min={1}
            max={50}
            onChange={(event) => setLimit(event.target.value)}
            type="number"
            value={limit}
          />
        </label>
        <button onClick={refreshPackage} type="button">
          重新生成任务包
        </button>
        <textarea
          readOnly
          rows={18}
          value={JSON.stringify(taskPackage, null, 2)}
        />
        <p className="notice">
          当前任务包包含 {taskPackage.items.length} 道未分类题；可用目标父节点{" "}
          {taskPackage.target_parent_nodes.length} 个。
        </p>
      </section>

      <section className="stage-b-card">
        <h2>2. 导入 AI 建议 JSON</h2>
        <p>
          建议导入后只进入待确认状态；拒绝和跳过不会改图，也不会成为正例经验。
        </p>
        <textarea
          onChange={(event) => setImportText(event.target.value)}
          placeholder='{"suggestions":[{"node_id":"00000000","recommended_parent_node_id":"00000000","reason":"...","confidence":"medium","evidence":["关键词"]}]}'
          rows={12}
          value={importText}
        />
        <button onClick={importSuggestions} type="button">
          导入为待确认建议
        </button>
      </section>

      <section className="stage-b-card stage-b-wide">
        <h2>3. 待确认建议</h2>
        {!pendingRecords.length && <p className="notice">暂无待确认建议。</p>}
        {pendingRecords.map((record) => (
          <SuggestionRow
            key={record.suggestion_id}
            onDecide={recordDecision}
            onMove={handleMove}
            record={record}
            targetItems={targetItems}
            targetLabel={targetLabel}
          />
        ))}
      </section>
    </div>
  );
}

function SuggestionRow({
  record,
  targetItems,
  targetLabel,
  onMove,
  onDecide,
}: {
  record: PendingSuggestionStore["records"][number];
  targetItems: {
    node_id: string;
    name: string;
    path: string;
    status: string;
    unavailable_reason: string;
  }[];
  targetLabel: (nodeId: string) => string;
  onMove: (input: {
    suggestionId: string;
    nodeId: string;
    targetParentId: string;
    status: "accepted" | "overridden";
    reason: string;
  }) => Promise<void>;
  onDecide: (input: {
    suggestionId: string;
    status: "accepted" | "overridden" | "rejected" | "skipped";
    finalParentNodeId?: string;
    reason?: string;
    graphEventId?: string;
  }) => Promise<boolean>;
}) {
  const [overrideParentId, setOverrideParentId] = useState(
    record.suggestion.recommended_parent_node_id,
  );
  const [decisionReason, setDecisionReason] = useState(
    record.suggestion.reason ?? "",
  );
  const evidence = Array.isArray(record.suggestion.evidence)
    ? record.suggestion.evidence.join("；")
    : record.suggestion.evidence ?? "";

  return (
    <article className="stage-b-suggestion">
      <header>
        <h3>{record.node_snapshot.name}</h3>
        <span>{record.node_snapshot.node_id}</span>
      </header>
      <dl>
        <div>
          <dt>当前父节点</dt>
          <dd>{record.node_snapshot.parent_name || record.node_snapshot.parent_node_id}</dd>
        </div>
        <div>
          <dt>AI推荐</dt>
          <dd>{targetLabel(record.suggestion.recommended_parent_node_id)}</dd>
        </div>
        <div>
          <dt>置信度</dt>
          <dd>{record.suggestion.confidence ?? "low"}</dd>
        </div>
        <div>
          <dt>依据</dt>
          <dd>{evidence || "未填写"}</dd>
        </div>
      </dl>
      <p>{record.suggestion.reason || "AI未填写推荐理由。"}</p>
      <label>
        人工确认理由（可留空）
        <input
          onChange={(event) => setDecisionReason(event.target.value)}
          value={decisionReason}
        />
      </label>
      <NodeCombobox
        defaultNodeId={overrideParentId}
        items={targetItems}
        label="改判目标父节点"
        name={`override-${record.suggestion_id}`}
        onResolvedNodeId={setOverrideParentId}
      />
      <div className="stage-b-actions">
        <button
          onClick={() =>
            onMove({
              suggestionId: record.suggestion_id,
              nodeId: record.suggestion.node_id,
              targetParentId: record.suggestion.recommended_parent_node_id,
              status: "accepted",
              reason: decisionReason,
            })
          }
          type="button"
        >
          接受建议
        </button>
        <button
          onClick={() =>
            onMove({
              suggestionId: record.suggestion_id,
              nodeId: record.suggestion.node_id,
              targetParentId: overrideParentId,
              status: "overridden",
              reason: decisionReason,
            })
          }
          type="button"
        >
          按改判移动
        </button>
        <button
          onClick={() =>
            onDecide({
              suggestionId: record.suggestion_id,
              status: "rejected",
              reason: decisionReason,
            })
          }
          type="button"
        >
          拒绝
        </button>
        <button
          onClick={() =>
            onDecide({
              suggestionId: record.suggestion_id,
              status: "skipped",
              reason: decisionReason,
            })
          }
          type="button"
        >
          跳过
        </button>
      </div>
    </article>
  );
}
