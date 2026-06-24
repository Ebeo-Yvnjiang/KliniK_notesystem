"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MarkdownContent } from "@/components/markdown-content";

const classificationFields = [
  "classification_status",
  "classification_confidence",
] as const;

function bodyWithoutFrontmatter(source: string) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function frontmatterScalar(source: string, field: string) {
  const match = source
    .match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
    .match(new RegExp(`^${field}:\\s*(.*?)\\s*$`, "m"));
  return (match?.[1] ?? "").replace(/^(['"])(.*)\1$/, "$2");
}

function classificationChanged(before: string, after: string) {
  return classificationFields.some(
    (field) => frontmatterScalar(before, field) !== frontmatterScalar(after, field),
  );
}

export function ContentEditor({
  target,
  initialSource,
  initialVersion,
  currentParentId,
  parentOptions = [],
  onEditingChange,
}: {
  target: { kind: "node"; id: string };
  initialSource: string;
  initialVersion: string;
  currentParentId: string | null;
  parentOptions?: {
    node_id: string;
    name: string;
    path: string;
    disabled?: boolean;
    disabledReason?: string;
  }[];
  onEditingChange?: (editing: boolean) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(initialSource);
  const [savedSource, setSavedSource] = useState(initialSource);
  const [savedVersion, setSavedVersion] = useState(initialVersion);
  const [selectedParentId, setSelectedParentId] = useState(
    currentParentId ?? "",
  );
  const [savedParentId, setSavedParentId] = useState(currentParentId ?? "");
  const [classificationReason, setClassificationReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const dirty =
    source !== savedSource || selectedParentId !== savedParentId;
  const hasClassificationChange = useMemo(
    () =>
      selectedParentId !== savedParentId ||
      classificationChanged(savedSource, source),
    [savedParentId, savedSource, selectedParentId, source],
  );
  const preview = useMemo(() => bodyWithoutFrontmatter(source), [source]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/private-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          source,
          baseHash: savedVersion,
          desiredParentId:
            selectedParentId !== savedParentId ? selectedParentId : undefined,
          classificationReason: hasClassificationChange
            ? classificationReason
            : "",
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        source?: string;
        version?: string;
        error?: string;
        warning?: string;
        classificationCorrection?: {
          logged: boolean;
          eventId?: string;
          guidanceRefreshed: boolean;
        };
      };
      if (!response.ok || !result.ok || !result.source || !result.version) {
        throw new Error(result.error ?? "保存失败。");
      }
      setSource(result.source);
      setSavedSource(result.source);
      setSavedVersion(result.version);
      setSavedParentId(selectedParentId);
      setClassificationReason("");
      const logMessage = result.classificationCorrection?.logged
        ? "分类修正已写入审计日志。"
        : "本次没有分类字段变化，未写入分类日志。";
      setMessage(
        result.warning
          ? `内容保存成功，${logMessage}${result.warning}`
          : `保存成功，已写入项目文件并启用人工覆盖保护。${logMessage}`,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (dirty && !window.confirm("放弃尚未保存的修改？")) return;
    setSource(savedSource);
    setSelectedParentId(savedParentId);
    setClassificationReason("");
    setMessage("");
    setEditing(false);
    onEditingChange?.(false);
  }

  if (!editing) {
    return (
      <div className="editor-entry">
        <button
          onClick={() => {
            setEditing(true);
            onEditingChange?.(true);
          }}
          type="button"
        >
          编辑 Markdown / MDX
        </button>
        <span>保存后直接写入本地 private 内容文件。</span>
      </div>
    );
  }

  return (
    <section className="content-editor">
      <div className="editor-toolbar">
        <button disabled={saving || !dirty} onClick={save} type="button">
          {saving ? "保存中…" : "保存"}
        </button>
        <button disabled={saving} onClick={cancel} type="button">
          取消
        </button>
        <span className={dirty ? "editor-dirty" : ""}>
          {dirty ? "有未保存修改" : "已保存"}
        </span>
      </div>
      {hasClassificationChange && (
        <label className="classification-reason">
          修改理由（可选）
          <textarea
            maxLength={1000}
            onChange={(event) => setClassificationReason(event.target.value)}
            placeholder="例如：讨论双棒感应电动势和稳定电流，应归入电磁感应。"
            value={classificationReason}
          />
          <small>
            仅在 module、submodule 或分类相关字段发生变化时写入审计日志；留空不会自动编造理由。
          </small>
        </label>
      )}
      {parentOptions.length > 0 && (
        <label className="classification-parent-selector">
          主要归属容器
          <select
            onChange={(event) => setSelectedParentId(event.target.value)}
            value={selectedParentId}
          >
            {parentOptions.map((option) => (
              <option
                disabled={option.disabled}
                key={option.node_id}
                value={option.node_id}
              >
                {option.path}
                {option.disabledReason ? `（${option.disabledReason}）` : ""}
              </option>
            ))}
          </select>
          <small>
            保存后将以节点 ID 移动内容；显示名称只来自节点数据，不再作为身份主键。
          </small>
        </label>
      )}
      {message && <p className="editor-message">{message}</p>}
      <div className="editor-grid">
        <label>
          Markdown / MDX 源码（含 frontmatter）
          <textarea
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            value={source}
          />
        </label>
        <div className="editor-preview">
          <p className="eyebrow">PREVIEW</p>
          <MarkdownContent content={preview} />
        </div>
      </div>
    </section>
  );
}
