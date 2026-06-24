"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterNodeSelectorItems,
  resolveNodeSelectorInput,
  type NodeSelectorItem,
} from "@/lib/graph/node-selector";

export function NodeCombobox({
  label,
  name,
  items,
  defaultNodeId = "",
  onResolvedNodeId,
}: {
  label: string;
  name: string;
  items: NodeSelectorItem[];
  defaultNodeId?: string;
  onResolvedNodeId?: (nodeId: string) => void;
}) {
  const [query, setQuery] = useState(defaultNodeId);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resolved = useMemo(
    () => resolveNodeSelectorInput(items, query),
    [items, query],
  );
  const candidates = useMemo(
    () => filterNodeSelectorItems(items, query),
    [items, query],
  );
  const validationMessage = resolved.error;

  useEffect(() => {
    onResolvedNodeId?.(resolved.error ? "" : resolved.nodeId);
  }, [onResolvedNodeId, resolved.error, resolved.nodeId]);

  function syncValidity(message: string) {
    inputRef.current?.setCustomValidity(message);
  }

  function highlighted(text: string) {
    const needle = query.trim();
    if (!needle || /^\d+$/.test(needle)) return text;
    const index = text.toLocaleLowerCase("zh-CN").indexOf(
      needle.toLocaleLowerCase("zh-CN"),
    );
    if (index < 0) return text;
    return (
      <>
        {text.slice(0, index)}
        <mark>{text.slice(index, index + needle.length)}</mark>
        {text.slice(index + needle.length)}
      </>
    );
  }

  return (
    <div className="node-combobox">
      <label>
        {label}
        <input
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          autoComplete="off"
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            syncValidity(
              resolveNodeSelectorInput(items, event.target.value).error,
            );
          }}
          onFocus={() => setOpen(true)}
          onInvalid={() => syncValidity(validationMessage)}
          placeholder="输入节点名称或完整8位ID"
          ref={inputRef}
          required
          role="combobox"
          value={query}
        />
      </label>
      <input name={name} type="hidden" value={resolved.nodeId} />
      {resolved.item && !resolved.error ? (
        <div className="node-combobox-selection">
          <strong>
            已选择：{resolved.item.name} · {resolved.item.node_id}
          </strong>
          <span>{resolved.item.path}</span>
          {resolved.item.status !== "active" && (
            <span>状态：{resolved.item.status}</span>
          )}
        </div>
      ) : (
        query && <p className="node-combobox-error">{validationMessage}</p>
      )}
      {open && (
        <div className="node-combobox-options" role="listbox">
          {candidates.length ? (
            candidates.map((item) => (
              <button
                aria-label={`选择${item.name} ${item.node_id}`}
                disabled={Boolean(item.unavailable_reason)}
                key={item.node_id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery(item.node_id);
                  syncValidity(item.unavailable_reason ?? "");
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <strong>
                  {highlighted(item.name)} · {item.node_id}
                </strong>
                <span>{highlighted(item.path)}</span>
                <small>
                  {item.unavailable_reason ||
                    (item.status === "active" ? "可选择" : item.status)}
                </small>
              </button>
            ))
          ) : (
            <p>没有匹配的节点。</p>
          )}
        </div>
      )}
    </div>
  );
}
