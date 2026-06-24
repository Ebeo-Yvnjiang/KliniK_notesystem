"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProblemIndexItem } from "@/lib/types";

function confidenceLabel(value?: string) {
  return value ?? "missing";
}

function analysisLabel(value: ProblemIndexItem["analysis_state"]) {
  if (value === "empty") return "空卡";
  if (value === "partial") return "半解析";
  return "有原始解析";
}

export function ProblemTable({
  problems,
  showFilters,
  parentOptions,
  validNodeIds = [],
}: {
  problems: ProblemIndexItem[];
  showFilters: boolean;
  parentOptions?: { id: string; name: string }[];
  validNodeIds?: string[];
}) {
  const [query, setQuery] = useState("");
  const [parentId, setParentId] = useState("全部");
  const [todoOnly, setTodoOnly] = useState(false);
  const linkedNodes = useMemo(() => new Set(validNodeIds), [validNodeIds]);
  const modules = useMemo(
    () => parentOptions ?? [
      { id: "全部", name: "全部" },
      ...Array.from(
        new Map(
          problems.map((item) => [
            item.primary_parent_id,
            { id: item.primary_parent_id, name: item.module },
          ]),
        ).values(),
      ),
    ],
    [parentOptions, problems],
  );
  const filtered = problems.filter((problem) => {
    const haystack = [
      problem.id,
      problem.anchor_text,
      problem.anchor_type,
      problem.module,
      ...problem.error_type,
      ...problem.knowledge_points,
      problem.status,
    ]
      .join(" ")
      .toLowerCase();
    return (
      haystack.includes(query.toLowerCase()) &&
      (parentId === "全部" || problem.primary_parent_id === parentId) &&
      (!todoOnly || problem.has_todo)
    );
  });

  return (
    <section>
      {showFilters && (
        <div className="filters">
          <label>
            搜索
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="题目锚点、类型、模块、错因、知识点、状态"
              type="search"
              value={query}
            />
          </label>
          <label>
            模块
            <select
              onChange={(event) => setParentId(event.target.value)}
              value={parentId}
            >
              {modules.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.id}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              checked={todoOnly}
              onChange={(event) => setTodoOnly(event.target.checked)}
              type="checkbox"
            />
            只看待整理
          </label>
          <p className="result-count">{filtered.length} 条</p>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>题目锚点</th>
              <th>锚点类型</th>
              <th>模块</th>
              <th>解析状态</th>
              <th>信度</th>
              <th>错因标签</th>
              <th>知识点</th>
              <th>状态</th>
              <th>文件</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((problem) => {
              const hasNode = linkedNodes.has(problem.node_id);
              return (
              <tr key={problem.id}>
                <td>
                  {hasNode ? (
                    <Link href={`/nodes/${problem.node_id}`}>
                      {problem.anchor_text || problem.id}
                    </Link>
                  ) : (
                    <span>{problem.anchor_text || problem.id}</span>
                  )}
                  <small>{problem.id}</small>
                </td>
                <td>{problem.anchor_type}</td>
                <td>
                  {problem.module}
                  <small>父节点 {problem.primary_parent_id}</small>
                </td>
                <td>
                  <span className={`badge analysis-${problem.analysis_state}`}>
                    {analysisLabel(problem.analysis_state)}
                  </span>
                  {problem.needs_ai_analysis && (
                    <span className="badge needs-ai">待 AI 补解析</span>
                  )}
                  <small>
                    原始解析：{problem.has_original_analysis ? "有" : "无"}
                  </small>
                </td>
                <td>
                  <span
                    className={`badge confidence-${confidenceLabel(problem.boundary_confidence)}`}
                  >
                    边界 {confidenceLabel(problem.boundary_confidence)}
                  </span>
                  <span
                    className={`badge confidence-${confidenceLabel(problem.classification_confidence)}`}
                  >
                    分类 {confidenceLabel(problem.classification_confidence)}
                  </span>
                </td>
                <td>{problem.error_type.join("、")}</td>
                <td>{problem.knowledge_points.join("、")}</td>
                <td>{problem.status}</td>
                <td className="file-path">{problem.file_path}</td>
                <td>
                  {hasNode ? (
                    <div className="problem-actions">
                      <Link
                        aria-label={`查看题目 ${problem.anchor_text || problem.id}`}
                        href={`/nodes/${problem.node_id}`}
                        title="查看题目内容"
                      >
                        查看题目
                      </Link>
                      <Link
                        aria-label={`管理题目 ${problem.anchor_text || problem.id}`}
                        href={`/admin/nodes?node=${problem.node_id}`}
                        title="在节点管理中定位此题"
                      >
                        管理题目
                      </Link>
                    </div>
                  ) : (
                    <span className="badge confidence-missing">
                      未关联节点
                    </span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
