import Link from "next/link";
import { InvalidateCorrectionButton } from "@/components/invalidate-correction-button";
import { getClassificationCorrectionRecords } from "@/lib/classification-corrections";
import { getGraphNodes } from "@/lib/graph/store";

export const metadata = { title: "人工分类修正日志" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  q?: string;
  from?: string;
  to?: string;
}>;

export default async function ClassificationCorrectionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const filters = await searchParams;
  const query = filters.q?.trim().toLowerCase() ?? "";
  const from = filters.from ?? "";
  const to = filters.to ?? "";
  const { records, errors } = getClassificationCorrectionRecords();
  const graphNodes = getGraphNodes();
  const containerById = new Map(
    graphNodes
      .filter((node) =>
        ["module", "system_placeholder"].includes(node.content_type),
      )
      .map((node) => [node.node_id, node]),
  );
  const modules = [...containerById.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN"),
  );

  const filtered = records
    .filter(
      ({ event }) => !from || event.before.parent_node_id === from,
    )
    .filter(({ event }) => !to || event.after.parent_node_id === to)
    .filter(({ event }) => {
      if (!query) return true;
      return [
        event.content_id,
        event.anchor_text,
        event.file_path,
        event.content_excerpt,
        event.reason,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((left, right) =>
      right.event.timestamp.localeCompare(left.event.timestamp),
    );

  return (
    <>
      <section className="page-heading backend-heading">
        <p className="eyebrow">PRIVATE AUDIT LOG</p>
        <h1>人工分类修正日志</h1>
        <p>
          只记录最终保存产生的分类字段变化。历史事件不会物理删除；纠正或失效操作会追加新事件。
        </p>
        <div className="quick-links">
          <Link href="/problems">返回题目索引</Link>
        </div>
      </section>

      <form className="correction-filters" method="get">
        <label>
          搜索
          <input
            defaultValue={filters.q}
            name="q"
            placeholder="题号、锚点、路径、摘要"
          />
        </label>
        <label>
          原模块
          <select defaultValue={from} name="from">
            <option value="">全部</option>
            {modules.map((moduleNode) => (
              <option key={moduleNode.node_id} value={moduleNode.node_id}>
                {moduleNode.name} · {moduleNode.node_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          新模块
          <select defaultValue={to} name="to">
            <option value="">全部</option>
            {modules.map((moduleNode) => (
              <option key={moduleNode.node_id} value={moduleNode.node_id}>
                {moduleNode.name} · {moduleNode.node_id}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">筛选</button>
        <Link href="/review/classification-corrections">清除</Link>
      </form>

      <p className="result-count">
        当前显示 {filtered.length} / {records.length} 条事件（按时间倒序）
      </p>
      {errors.length > 0 && (
        <div className="notice">
          检测到 {errors.length} 行日志格式错误：
          {errors.slice(0, 5).map((error) => (
            <span key={`${error.line}-${error.message}`}>
              第 {error.line} 行：{error.message}
            </span>
          ))}
        </div>
      )}

      <div className="correction-list">
        {filtered.map(({ event, superseded, stale }) => {
          const effective =
            event.active &&
            !superseded &&
            !stale &&
            (event.event_type ?? "classification_correction") ===
              "classification_correction";
          return (
            <article className="correction-card" key={event.event_id}>
              <header>
                <div>
                  <p className="eyebrow">
                    {event.event_type === "invalidation"
                      ? "INVALIDATION"
                      : "CLASSIFICATION CORRECTION"}
                  </p>
                  <h2>{event.anchor_text || event.content_id}</h2>
                </div>
                <div className="correction-status">
                  <span className={effective ? "status-active" : "status-inactive"}>
                    {effective ? "当前有效" : "当前无效"}
                  </span>
                  {superseded && <span>已被后续事件取代</span>}
                  {stale && <span>内容哈希已变化</span>}
                </div>
              </header>

              <dl className="correction-change">
                <div>
                  <dt>模块</dt>
                  <dd>
                    {event.before.parent_name_snapshot ||
                      event.before.module ||
                      "（空）"}{" "}
                    [{event.before.parent_node_id || "legacy"}] →{" "}
                    {event.after.parent_name_snapshot ||
                      event.after.module ||
                      "（空）"}{" "}
                    [{event.after.parent_node_id || "legacy"}]
                  </dd>
                </div>
                <div>
                  <dt>子模块</dt>
                  <dd>
                    {event.before.submodule || "（空）"} →{" "}
                    {event.after.submodule || "（空）"}
                  </dd>
                </div>
                <div>
                  <dt>分类状态</dt>
                  <dd>
                    {event.before.classification_status || "（空）"} →{" "}
                    {event.after.classification_status || "（空）"}
                  </dd>
                </div>
                <div>
                  <dt>分类信度</dt>
                  <dd>
                    {event.before.classification_confidence || "（空）"} →{" "}
                    {event.after.classification_confidence || "（空）"}
                  </dd>
                </div>
                <div>
                  <dt>内容类型</dt>
                  <dd>
                    {event.before.content_type || "（空）"} →{" "}
                    {event.after.content_type || "（空）"}
                  </dd>
                </div>
                <div>
                  <dt>修改时间</dt>
                  <dd>{new Date(event.timestamp).toLocaleString("zh-CN")}</dd>
                </div>
              </dl>

              <details>
                <summary>查看前后变化与审计信息</summary>
                <p>{event.content_excerpt || "（无可用摘要）"}</p>
                <p>
                  <strong>修改字段：</strong>
                  {event.changed_fields.join("、") || "无（失效事件）"}
                </p>
                <p>
                  <strong>修改理由：</strong>
                  {event.reason || "未填写"}
                </p>
                <p className="file-path">{event.file_path}</p>
                <p className="file-path">事件 ID：{event.event_id}</p>
                {event.supersedes_event_id && (
                  <p className="file-path">
                    取代事件：{event.supersedes_event_id}
                  </p>
                )}
              </details>

              {effective && (
                <InvalidateCorrectionButton eventId={event.event_id} />
              )}
            </article>
          );
        })}
        {!filtered.length && <p className="notice">没有符合当前条件的事件。</p>}
      </div>
    </>
  );
}
