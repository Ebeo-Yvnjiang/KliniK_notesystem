"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NodeCombobox } from "@/components/node-combobox";
import {
  contentTemplateOptions,
  isSystemPurpose,
  nodePurposeOptions,
  type NodePurpose,
} from "@/lib/graph/create-types";

type AdminNode = {
  node_id: string;
  name: string;
  node_kind: string;
  content_type: string;
  primary_parent_id: string | null;
  parent_name: string;
  status: string;
  sort_order: number;
  direct_children: number;
  descendants: number;
  incoming_edges: number;
  outgoing_edges: number;
  permission_policy_id: string;
  effective_permission_policy_id: string;
  can_create_child: boolean;
  content_path: string | null;
  updated_at: string;
  metadata: Record<string, unknown>;
  content_target_node_id: string | null;
};

type AdminEdge = {
  edge_id: string;
  from_node_id: string;
  to_node_id: string;
  relation_type: string;
};

type AdminAuditEvent = {
  event_id: string;
  event_type: string;
  timestamp: string;
  success: boolean;
  node_ids: string[];
  backup_path: string | null;
  reason: string;
  failure_reason: string | null;
};

type AdminBackup = {
  backupPath: string;
  createdAt: string;
  category: "migration" | "operation" | "test" | "restore_safety";
  sourceOperation: string;
  fileCount: number;
  restorable: boolean;
  retention: "keep" | "recent" | "test_candidate" | "cleanup_candidate";
};

export function GraphAdminPanel({
  nodes,
  edges,
  auditEvents,
  selectedNodeId,
  initialGraphVersion,
  backups,
}: {
  nodes: AdminNode[];
  edges: AdminEdge[];
  auditEvents: AdminAuditEvent[];
  selectedNodeId: string;
  initialGraphVersion: string;
  backups: AdminBackup[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState(selectedNodeId);
  const [message, setMessage] = useState("");
  const [graphVersion, setGraphVersion] = useState(initialGraphVersion);
  const selected = nodes.find((node) => node.node_id === selectedNodeId);
  const selectedSiblings = useMemo(
    () =>
      selected?.primary_parent_id
        ? nodes
            .filter(
              (node) =>
                node.primary_parent_id === selected.primary_parent_id,
            )
            .sort(
              (left, right) =>
                left.sort_order - right.sort_order ||
                left.node_id.localeCompare(right.node_id),
            )
        : [],
    [nodes, selected],
  );
  const [siblingOrder, setSiblingOrder] = useState<string[]>([]);
  const [draggedNodeId, setDraggedNodeId] = useState("");
  useEffect(() => {
    setSiblingOrder(selectedSiblings.map((node) => node.node_id));
  }, [selectedNodeId, selectedSiblings]);
  useEffect(() => {
    if (!selectedNodeId) return;
    document
      .getElementById(`admin-node-${selectedNodeId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedNodeId]);
  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    return nodes.filter((node) =>
      [
        node.node_id,
        node.name,
        node.node_kind,
        node.content_type,
        node.status,
        node.content_path ?? "",
        node.permission_policy_id,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [nodes, query]);
  const orderedSiblings = siblingOrder
    .map((nodeId) => selectedSiblings.find((node) => node.node_id === nodeId))
    .filter((node): node is AdminNode => Boolean(node));
  const originalSiblingOrder = selectedSiblings.map((node) => node.node_id);
  const siblingOrderChanged =
    siblingOrder.join(",") !== originalSiblingOrder.join(",");

  function typeClass(contentType: string) {
    const classes: Record<string, string> = {
      knowledge_base: "type-knowledge-base",
      subject: "type-subject",
      module: "type-module",
      system_placeholder: "type-system-placeholder",
      module_summary: "type-module-summary",
      problem_note: "type-problem-note",
      unassigned_fragments: "type-unassigned-fragments",
      raw_note: "type-raw-note",
    };
    return classes[contentType] ?? "type-default";
  }

  function moveSibling(draggedId: string, targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    setSiblingOrder((current) => {
      const next = current.filter((nodeId) => nodeId !== draggedId);
      const targetIndex = next.indexOf(targetId);
      next.splice(targetIndex, 0, draggedId);
      return next;
    });
  }

  function purposeUnavailableReason(
    purpose: NodePurpose,
    parentId: string,
  ) {
    if (
      ["module_summary", "unassigned_fragments"].includes(purpose) &&
      nodes.some(
        (node) =>
          node.primary_parent_id === parentId &&
          node.content_type === purpose &&
          node.status === "active",
      )
    ) {
      return purpose === "module_summary"
        ? "已有有效模块总结"
        : "已有有效未归属内容";
    }
    return "";
  }

  function isDescendantOf(candidateId: string, ancestorId: string) {
    const byId = new Map(nodes.map((node) => [node.node_id, node]));
    const visited = new Set<string>();
    let current = byId.get(candidateId);
    while (current?.primary_parent_id) {
      if (visited.has(current.node_id)) return true;
      visited.add(current.node_id);
      if (current.primary_parent_id === ancestorId) return true;
      current = byId.get(current.primary_parent_id);
    }
    return false;
  }

  function parentUnavailableReason(
    candidate: AdminNode,
    movingNodeId: string,
  ) {
    if (candidate.node_id === movingNodeId) return "不能选择自身";
    if (candidate.status !== "active") return "节点已经归档";
    if (!candidate.can_create_child) {
      return "没有在该节点下创建子节点的权限";
    }
    if (isDescendantOf(candidate.node_id, movingNodeId)) {
      return "选择后会形成循环";
    }
    return "";
  }

  function nodePath(nodeId: string) {
    const byId = new Map(nodes.map((node) => [node.node_id, node]));
    const parts: string[] = [];
    const visited = new Set<string>();
    let current = byId.get(nodeId);
    while (current) {
      if (visited.has(current.node_id)) break;
      visited.add(current.node_id);
      parts.unshift(current.name);
      current = current.primary_parent_id
        ? byId.get(current.primary_parent_id)
        : undefined;
    }
    return parts.join(" / ");
  }

  function parentSelectorItems(movingNodeId?: string) {
    return nodes.map((node) => ({
      node_id: node.node_id,
      name: node.name,
      path: nodePath(node.node_id),
      status: node.status,
      unavailable_reason: movingNodeId
        ? parentUnavailableReason(node, movingNodeId)
        : node.status !== "active"
          ? "节点已经归档"
          : !node.can_create_child
            ? "没有在该节点下创建子节点的权限"
            : "",
    }));
  }

  function relationTargetSelectorItems(fromNodeId: string) {
    return nodes.map((node) => ({
      node_id: node.node_id,
      name: node.name,
      path: nodePath(node.node_id),
      status: node.status,
      unavailable_reason:
        node.node_id === fromNodeId ? "不能选择自身作为关系目标" : "",
    }));
  }

  async function run(
    action: string,
    payload: Record<string, unknown>,
  ) {
    setMessage("");
    const previewResponse = await fetch("/api/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "preview",
        action,
        payload,
        graphVersion,
      }),
    });
    const previewResult = await previewResponse.json();
    if (!previewResponse.ok || !previewResult.ok) {
      setMessage(previewResult.error ?? "预览失败。");
      return;
    }
    if (
      !window.confirm(
        `确认执行 ${action}？\n\n${JSON.stringify(previewResult.preview, null, 2)}`,
      )
    ) {
      return;
    }
    const response = await fetch("/api/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "commit",
        action,
        payload,
        graphVersion: previewResult.graphVersion,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setMessage(
        response.status === 409
          ? `${result.error ?? "图版本冲突。"} 请重新加载页面。`
          : result.error ?? "操作失败。",
      );
      return;
    }
    setGraphVersion(result.graphVersion);
    setMessage(
      `操作成功。备份：${result.backupPath ?? "无"}${
        result.warning ? `；${result.warning}` : ""
      }`,
    );
    router.refresh();
  }

  async function restoreBackup(backupPath: string) {
    setMessage("");
    const previewResponse = await fetch("/api/graph-backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "preview",
        backupPath,
        graphVersion,
      }),
    });
    const preview = await previewResponse.json();
    if (!previewResponse.ok || !preview.ok) {
      setMessage(preview.error ?? "备份预览失败。");
      return;
    }
    if (
      !window.confirm(
        `确认恢复备份？恢复前会再次备份当前状态。\n\n${JSON.stringify(preview.preview, null, 2)}`,
      )
    ) {
      return;
    }
    const response = await fetch("/api/graph-backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "commit",
        backupPath,
        graphVersion: preview.graphVersion,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setMessage(
        response.status === 409
          ? `${result.error} 请重新加载页面。`
          : result.error ?? "备份恢复失败。",
      );
      return;
    }
    setGraphVersion(result.graphVersion);
    setMessage(`备份已恢复；恢复前安全备份：${result.safetyBackupPath}`);
    router.refresh();
  }

  function formData(form: HTMLFormElement) {
    return Object.fromEntries(new FormData(form).entries());
  }

  return (
    <div className="admin-grid">
      <section className="admin-node-list">
        <label>
          搜索节点
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ID、名称、类型、状态、路径、权限"
            value={query}
          />
        </label>
        {selectedNodeId && (
          <div className="admin-location-tools">
            <span>正在定位节点：{selectedNodeId}</span>
            <button onClick={() => setQuery("")} type="button">
              显示全部节点
            </button>
            <a href="/admin/nodes">清除定位</a>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>类型</th>
                <th>父节点</th>
                <th>状态</th>
                <th>子/后代</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((node) => (
                <tr
                  className={`${typeClass(node.content_type)} ${
                    node.node_id === selectedNodeId ? "admin-node-target" : ""
                  }`}
                  id={`admin-node-${node.node_id}`}
                  key={node.node_id}
                >
                  <td>
                    <a href={`/admin/nodes?node=${node.node_id}`}>
                      {node.node_id}
                    </a>
                  </td>
                  <td>{node.name}</td>
                  <td>
                    <span className={`node-type-badge ${typeClass(node.content_type)}`}>
                      {node.content_type}
                    </span>
                    <small>{node.node_kind}</small>
                  </td>
                  <td>{node.parent_name || "—"}</td>
                  <td>{node.status}</td>
                  <td>
                    {node.direct_children}/{node.descendants}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="admin-actions">
        {message && <p className="editor-message">{message}</p>}
        {!selected && !selectedNodeId && (
          <p className="notice">选择一个节点查看和管理。</p>
        )}
        {!selected && selectedNodeId && (
          <p className="notice">
            定位节点 {selectedNodeId} 不存在或已失效。
            <a href="/admin/nodes">返回普通节点列表</a>
          </p>
        )}
        <details className="admin-backups">
          <summary>备份管理（{backups.length}）</summary>
          <p className="notice">
            迁移备份永久保留；近期正常备份建议保留；测试备份仅标记为清理候选，本页面不会自动删除。
          </p>
          {backups.slice(0, 30).map((backup) => (
            <div className="admin-edge" key={backup.backupPath}>
              <span>
                {new Date(backup.createdAt).toLocaleString("zh-CN")} ·{" "}
                {backup.category} · {backup.sourceOperation}
                <br />
                {backup.fileCount} 个文件 · 保留标记：{backup.retention}
                <br />
                {backup.backupPath}
              </span>
              <button
                disabled={!backup.restorable}
                onClick={() => restoreBackup(backup.backupPath)}
                type="button"
              >
                {backup.restorable ? "预览并恢复" : "仅供留档"}
              </button>
            </div>
          ))}
        </details>
        {selected && (
          <>
            <h2>{selected.name}</h2>
            <p className="file-path">{selected.node_id}</p>
            <div className="admin-content-link">
              {selected.content_target_node_id ? (
                <a
                  aria-label={`查看${selected.name}的内容`}
                  href={`/nodes/${selected.content_target_node_id}`}
                  title="使用规范节点路由查看内容"
                >
                  查看内容 ↗
                </a>
              ) : (
                <button
                  aria-label={`${selected.name}没有可查看的正文`}
                  disabled
                  title="此节点没有正文或对应总结"
                  type="button"
                >
                  无内容
                </button>
              )}
            </div>
            <dl className="admin-node-facts">
              <div><dt>父节点</dt><dd>{selected.parent_name || "—"}</dd></div>
              <div><dt>排序</dt><dd>{selected.sort_order}</dd></div>
              <div><dt>直接/递归</dt><dd>{selected.direct_children}/{selected.descendants}</dd></div>
              <div><dt>入边/出边</dt><dd>{selected.incoming_edges}/{selected.outgoing_edges}</dd></div>
              <div><dt>权限</dt><dd>{selected.effective_permission_policy_id}</dd></div>
              <div><dt>内容路径</dt><dd>{selected.content_path ?? "—"}</dd></div>
            </dl>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = formData(event.currentTarget);
                let metadata: Record<string, unknown>;
                try {
                  metadata = JSON.parse(String(values.metadata || "{}")) as Record<
                    string,
                    unknown
                  >;
                } catch {
                  setMessage("metadata必须是有效JSON对象。");
                  return;
                }
                run("rename", {
                  node_id: selected.node_id,
                  name: values.name,
                  aliases: String(values.aliases ?? "")
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                  keep_old_name_as_alias: values.keep_old === "on",
                  metadata,
                  reason: values.reason,
                });
              }}
            >
              <h3>改名与别名</h3>
              <input defaultValue={selected.name} name="name" required />
              <input name="aliases" placeholder="别名，逗号分隔" />
              <textarea
                defaultValue={JSON.stringify(selected.metadata, null, 2)}
                name="metadata"
              />
              <label><input name="keep_old" type="checkbox" /> 保留旧名称为别名</label>
              <input name="reason" placeholder="操作理由" />
              <button type="submit">预览改名</button>
            </form>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = formData(event.currentTarget);
                run("move", {
                  node_id: selected.node_id,
                  target_parent_id: values.target_parent_id,
                  reason: values.reason,
                  classification_evidence: values.classification === "on",
                });
              }}
            >
              <h3>移动节点/分支</h3>
              <NodeCombobox
                defaultNodeId={selected.primary_parent_id ?? ""}
                items={parentSelectorItems(selected.node_id)}
                label="目标父节点"
                name="target_parent_id"
              />
              <label>
                <input name="classification" type="checkbox" />
                这是题目真实分类修正
              </label>
              <input name="reason" placeholder="移动理由" />
              <button type="submit">预览移动</button>
            </form>

            {selected.status === "active" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = formData(event.currentTarget);
                  run("create", {
                    parent_node_id: values.parent_node_id,
                    name: values.name,
                    purpose: values.purpose,
                    create_content: values.create_content === "on",
                    content_template: values.content_template,
                    slug: values.slug,
                  });
                }}
              >
                <h3>新建子节点</h3>
                <input name="name" placeholder="正式名称" required />
                <NodeCombobox
                  defaultNodeId={selected.node_id}
                  items={parentSelectorItems()}
                  label="主要父节点"
                  name="parent_node_id"
                />
                <label className="create-purpose-selector">
                  节点用途
                  <select name="purpose" required>
                    {nodePurposeOptions.map((option) => {
                      const reason = purposeUnavailableReason(
                        option.value,
                        selected.node_id,
                      );
                      return (
                        <option
                          disabled={Boolean(reason)}
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                          {reason ? `（${reason}）` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  <input name="create_content" type="checkbox" />
                  立即创建正文
                </label>
                <label>
                  正文初始模板
                  <select defaultValue="purpose_default" name="content_template">
                    {contentTemplateOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="create-purpose-help">
                  {nodePurposeOptions.map((option) => (
                    <p key={option.value}>
                      <strong>{option.label}：</strong>
                      {option.description}
                    </p>
                  ))}
                  <p>
                    用途只决定模板、展示、筛选和统计，不限制节点成为父节点或建立关系。
                  </p>
                </div>
                <input name="slug" placeholder="可选兼容slug（仅模块使用）" />
                <button type="submit">预览创建</button>
              </form>
            )}

            {!selected.content_path && selected.status === "active" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = formData(event.currentTarget);
                  run("create_content", {
                    node_id: selected.node_id,
                    content_template: values.content_template,
                    reason: values.reason,
                  });
                }}
              >
                <h3>为当前节点创建正文</h3>
                <p className="notice">
                  正文按需创建；创建后该节点仍可继续拥有子节点和关系。
                </p>
                <select defaultValue="purpose_default" name="content_template">
                  {contentTemplateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}：{option.description}
                    </option>
                  ))}
                </select>
                <input name="reason" placeholder="创建正文理由" />
                <button type="submit">预览创建正文</button>
              </form>
            )}

            {!isSystemPurpose(selected.content_type) &&
              !selected.metadata.immutable_archive &&
              selected.status === "active" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = formData(event.currentTarget);
                  run("change_purpose", {
                    node_id: selected.node_id,
                    purpose: values.purpose,
                    reason: values.reason,
                  });
                }}
              >
                <h3>修改节点用途</h3>
                <p className="notice">
                  用途变化不会改写现有正文，也不会改变ID、父子关系或关系边。
                </p>
                <select defaultValue={selected.content_type} name="purpose">
                  {nodePurposeOptions.map((option) => {
                    const reason = purposeUnavailableReason(
                      option.value,
                      selected.primary_parent_id ?? "",
                    );
                    return (
                      <option
                        disabled={
                          option.value !== selected.content_type &&
                          Boolean(reason)
                        }
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                        {reason && option.value !== selected.content_type
                          ? `（${reason}）`
                          : ""}
                      </option>
                    );
                  })}
                </select>
                <input name="reason" placeholder="用途变更理由" />
                <button type="submit">预览用途变更</button>
              </form>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = formData(event.currentTarget);
                run("bulk_move", {
                  node_id: selected.node_id,
                  node_ids: String(values.node_ids)
                    .split(/[\s,]+/)
                    .filter(Boolean),
                  target_parent_id: values.target_parent_id,
                  reason: values.reason,
                });
              }}
            >
              <h3>批量移动</h3>
              <textarea name="node_ids" placeholder="节点ID，逗号或换行分隔" />
              <NodeCombobox
                defaultNodeId={selected.primary_parent_id ?? selected.node_id}
                items={parentSelectorItems()}
                label="批量移动目标父节点"
                name="target_parent_id"
              />
              <p className="notice">
                批量移动会在服务端按每个源节点继续检查自身、后代、归档、权限和同名冲突。
              </p>
              <input name="reason" placeholder="移动理由" />
              <button type="submit">预览批量移动</button>
            </form>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = formData(event.currentTarget);
                run("create_edge", {
                  from_node_id: selected.node_id,
                  to_node_id: values.to_node_id,
                  relation_type: values.relation_type,
                });
              }}
            >
              <h3>创建关系边</h3>
              <NodeCombobox
                items={relationTargetSelectorItems(selected.node_id)}
                label="关系目标节点"
                name="to_node_id"
              />
              <select name="relation_type">
                {["cites", "related_to", "supports", "derived_from", "shortcut_to", "supersedes"].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              <button type="submit">预览创建关系</button>
            </form>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = formData(event.currentTarget);
                run("merge", {
                  node_id: selected.node_id,
                  target_node_id: values.target_node_id,
                  reason: values.reason,
                });
              }}
            >
              <h3>合并节点</h3>
              <NodeCombobox
                items={parentSelectorItems(selected.node_id)}
                label="合并目标节点"
                name="target_node_id"
              />
              <input name="reason" placeholder="合并理由" />
              <button type="submit">预览合并</button>
            </form>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = formData(event.currentTarget);
                run("rekey", {
                  node_id: selected.node_id,
                  new_node_id: values.new_node_id,
                  reason: values.reason,
                });
              }}
            >
              <h3>高级ID修改</h3>
              <input name="new_node_id" pattern="\d{8}" placeholder="8位新ID" />
              <input name="reason" placeholder="修改理由" />
              <button type="submit">预览ID修改</button>
            </form>

            {selected.primary_parent_id && selectedSiblings.length > 1 && (
              <section className="sibling-sort-panel">
                <h3>同级拖拽排序</h3>
                <p>
                  仅调整当前父节点下的显示顺序，不会改变任何节点的主要父节点。
                </p>
                <ol>
                  {orderedSiblings.map((node, index) => (
                    <li
                      className={`sibling-sort-item ${typeClass(node.content_type)}`}
                      draggable
                      key={node.node_id}
                      onDragEnd={() => setDraggedNodeId("")}
                      onDragOver={(event) => {
                        event.preventDefault();
                        moveSibling(draggedNodeId, node.node_id);
                      }}
                      onDragStart={() => setDraggedNodeId(node.node_id)}
                    >
                      <span className="drag-handle" aria-hidden="true">⋮⋮</span>
                      <span className="sibling-position">{index + 1}</span>
                      <strong>{node.name}</strong>
                      <span className="node-type-badge">
                        {node.content_type}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="sibling-sort-actions">
                  <button
                    disabled={!siblingOrderChanged}
                    onClick={() =>
                      run("reorder_siblings", {
                        parent_node_id: selected.primary_parent_id,
                        ordered_node_ids: siblingOrder,
                      })
                    }
                    type="button"
                  >
                    预览并提交新顺序
                  </button>
                  <button
                    disabled={!siblingOrderChanged}
                    onClick={() => setSiblingOrder(originalSiblingOrder)}
                    type="button"
                  >
                    恢复显示顺序
                  </button>
                </div>
                <form
                  className="sibling-keyboard-sort"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const values = formData(event.currentTarget);
                    run("reorder", {
                      node_id: selected.node_id,
                      sort_order: Number(values.sort_order),
                    });
                  }}
                >
                  <h4>键盘排序备用</h4>
                  <input
                    defaultValue={selected.sort_order}
                    name="sort_order"
                    type="number"
                  />
                  <button type="submit">按数字预览排序</button>
                </form>
              </section>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = formData(event.currentTarget);
                run("change_permission", {
                  node_id: selected.node_id,
                  permission_policy_id: values.permission_policy_id,
                  reason: values.reason,
                });
              }}
            >
              <h3>权限策略</h3>
              <select
                defaultValue={selected.permission_policy_id}
                name="permission_policy_id"
              >
                <option value="owner-full-control">
                  owner-full-control
                </option>
              </select>
              <input name="reason" placeholder="修改理由" />
              <button type="submit">预览权限修改</button>
            </form>

            <div className="admin-danger-actions">
              <div>
                <button
                  onClick={() =>
                    run(selected.status === "active" ? "archive" : "restore", {
                      node_id: selected.node_id,
                    })
                  }
                  type="button"
                >
                  {selected.status === "active" ? "预览归档" : "预览恢复"}
                </button>
                <small>
                  归档会保留节点、正文、关系和历史，使其退出普通索引；之后可以恢复。
                </small>
              </div>
              <div>
                <button
                  onClick={() =>
                    run("delete_empty", { node_id: selected.node_id })
                  }
                  type="button"
                >
                  预览永久删除空节点
                </button>
                <small>
                  仅允许永久删除无子节点、无正文、无入边和出边的空节点。
                </small>
              </div>
            </div>

            <h3>相关边</h3>
            {edges
              .filter(
                (edge) =>
                  edge.from_node_id === selected.node_id ||
                  edge.to_node_id === selected.node_id,
              )
              .map((edge) => (
                <div className="admin-edge" key={edge.edge_id}>
                  <span>
                    {edge.edge_id} · {edge.from_node_id} {edge.relation_type}{" "}
                    {edge.to_node_id}
                  </span>
                  <button
                    onClick={() => run("delete_edge", { edge_id: edge.edge_id })}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              ))}
            <h3>最近审计事件</h3>
            {auditEvents.map((event) => (
              <div className="admin-edge" key={event.event_id}>
                <span>
                  {event.timestamp} · {event.event_type} ·{" "}
                  {event.success ? "成功" : "失败"}
                  <br />
                  节点：{event.node_ids.join(", ") || "—"}
                  <br />
                  备份：{event.backup_path ?? "—"}
                  <br />
                  {event.failure_reason ?? event.reason}
                </span>
              </div>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}
