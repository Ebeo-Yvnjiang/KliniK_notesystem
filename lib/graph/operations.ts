import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  appendClassificationCorrectionEvent,
  buildClassificationGuidance,
  classificationLogPath,
  createProblemParentCorrectionEvent,
} from "../classification-corrections.ts";
import {
  allocateGraphIds,
  isNodeId,
  reserveSpecificNodeId,
  retireGraphId,
} from "./id-allocator.ts";
import {
  initialContentForCreatedNode,
  resolveCreateSpec,
  resolveContentTemplate,
  validatePurposeChange,
} from "./create-types.ts";
import {
  localAdminCan,
  parentCandidateDecision,
} from "./node-capabilities.ts";
import { rebuildDerivedIndexes, syncNodeContentIdentity } from "./derived.ts";
import {
  edgesPath,
  graphAuditPath,
  graphBackupsRoot,
  graphRoot,
  graphWriteLockPath,
  idStatePath,
  legacyRouteMapPath,
  moduleIndexPath,
  nodesPath,
  policiesPath,
  problemIndexPath,
  projectRoot,
  rekeyMapPath,
} from "./paths.ts";
import {
  readGraphData,
  getEffectivePermissionPolicy,
  getGraphVersion,
} from "./store.ts";
import type {
  GraphAuditEvent,
  GraphAuditEventType,
  GraphData,
  GraphEdge,
  GraphNode,
  PermissionPolicy,
  RelationType,
} from "./types.ts";
import { assertGraphValid } from "./validation.ts";

export type GraphAction =
  | "create"
  | "create_content"
  | "change_purpose"
  | "rename"
  | "move"
  | "bulk_move"
  | "reorder"
  | "reorder_siblings"
  | "archive"
  | "restore"
  | "delete_empty"
  | "merge"
  | "rekey"
  | "create_edge"
  | "delete_edge"
  | "change_permission";

export type GraphActionPayload = Record<string, unknown>;

export function applySiblingOrder(
  data: GraphData,
  parentNodeId: string,
  orderedNodeIds: string[],
) {
  const siblings = data.nodes.filter(
    (node) => node.primary_parent_id === parentNodeId,
  );
  const expected = siblings.map((node) => node.node_id).sort();
  const received = [...orderedNodeIds].sort();
  if (
    expected.length !== received.length ||
    new Set(orderedNodeIds).size !== orderedNodeIds.length ||
    expected.some((nodeId, index) => nodeId !== received[index])
  ) {
    throw new Error("新顺序必须完整包含同一父节点下的全部兄弟节点。");
  }
  orderedNodeIds.forEach((nodeId, index) => {
    const node = siblings.find((item) => item.node_id === nodeId)!;
    node.sort_order = index + 1;
  });
  return siblings;
}

export class GraphVersionConflictError extends Error {
  constructor() {
    super("图数据已被其他操作修改。请重新加载页面并重新预览。");
    this.name = "GraphVersionConflictError";
  }
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function acquireGraphLock(timeoutMs = 15_000) {
  await fs.mkdir(graphRoot, { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      return await fs.open(graphWriteLockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - started > timeoutMs) {
        throw new Error("图数据正被其他管理操作修改，请稍后重试。");
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
}

async function writeAtomic(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  await fs.writeFile(temp, content, "utf8");
  try {
    await fs.rename(temp, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(temp, filePath);
  }
}

function requiredString(payload: GraphActionPayload, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`缺少字段：${key}`);
  }
  return value.trim();
}

function optionalString(payload: GraphActionPayload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function boolValue(payload: GraphActionPayload, key: string) {
  return payload[key] === true;
}

function getNode(data: GraphData, nodeId: string) {
  if (!isNodeId(nodeId)) {
    throw new Error(`节点ID格式无效，必须是8位数字：${nodeId}`);
  }
  const node = data.nodes.find((item) => item.node_id === nodeId);
  if (!node) throw new Error(`节点不存在：${nodeId}`);
  return node;
}

function requirePermission(
  data: GraphData,
  nodeId: string,
  action:
    | "edit"
    | "move"
    | "create_child"
    | "create_edge"
    | "archive"
    | "delete"
    | "rekey"
    | "manage_permissions",
) {
  if (!localAdminCan(data, nodeId, action)) {
    throw new Error(`当前管理员没有执行 ${action} 的有效权限。`);
  }
}

function descendants(data: GraphData, nodeId: string) {
  const result: GraphNode[] = [];
  const queue = [nodeId];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) throw new Error(`后代遍历检测到循环：${current}`);
    visited.add(current);
    const children = data.nodes.filter(
      (node) => node.primary_parent_id === current,
    );
    result.push(...children);
    queue.push(...children.map((node) => node.node_id));
  }
  return result;
}

function siblingNameConflict(
  data: GraphData,
  parentId: string | null,
  name: string,
  exceptNodeId?: string,
) {
  const normalized = name.trim().toLocaleLowerCase("zh-CN");
  return data.nodes.find(
    (node) =>
      node.node_id !== exceptNodeId &&
      node.status === "active" &&
      node.primary_parent_id === parentId &&
      node.name.trim().toLocaleLowerCase("zh-CN") === normalized,
  );
}

function aliasesConflict(
  data: GraphData,
  parentId: string | null,
  aliases: string[],
  exceptNodeId?: string,
) {
  const candidates = new Set(
    aliases.map((alias) => alias.trim().toLocaleLowerCase("zh-CN")),
  );
  return data.nodes.find(
    (node) =>
      node.node_id !== exceptNodeId &&
      node.status === "active" &&
      node.primary_parent_id === parentId &&
      [node.name, ...node.aliases].some((value) =>
        candidates.has(value.trim().toLocaleLowerCase("zh-CN")),
      ),
  );
}

export function previewGraphAction(
  action: GraphAction,
  payload: GraphActionPayload,
) {
  const data = readGraphData();
  if (action === "create") {
    const parentId = requiredString(payload, "parent_node_id");
    const parent = getNode(data, parentId);
    const name = requiredString(payload, "name");
    const parentDecision = parentCandidateDecision(data, parentId);
    if (!parentDecision.allowed) {
      throw new Error(`不能在该父节点下创建内容：${parentDecision.reason}。`);
    }
    if (siblingNameConflict(data, parentId, name)) {
      throw new Error("同一主要父节点下已经存在同名有效节点。");
    }
    const spec = resolveCreateSpec(
      data,
      parent,
      payload.purpose,
      payload.create_content,
      payload.content_template,
    );
    return {
      action,
      parent: { node_id: parent.node_id, name: parent.name },
      new_node: {
        name,
        purpose: spec.purpose,
        node_kind: spec.node_kind,
        content_type: spec.content_type,
      },
      creates_content: spec.create_content,
      content_template: spec.content_template,
      effective_permission_policy:
        getEffectivePermissionPolicy(parent.node_id)?.permission_policy_id ??
        parent.permission_policy_id,
    };
  }

  if (action === "create_edge") {
    const from = getNode(data, requiredString(payload, "from_node_id"));
    const to = getNode(data, requiredString(payload, "to_node_id"));
    requirePermission(data, from.node_id, "create_edge");
    return {
      action,
      from: { node_id: from.node_id, name: from.name },
      to: { node_id: to.node_id, name: to.name },
      relation_type: requiredString(payload, "relation_type"),
      permissions_propagate: false,
      primary_parent_changes: false,
    };
  }

  if (action === "delete_edge") {
    const edgeId = requiredString(payload, "edge_id");
    const edge = data.edges.find((item) => item.edge_id === edgeId);
    if (!edge) throw new Error(`关系边不存在：${edgeId}`);
    requirePermission(data, edge.from_node_id, "create_edge");
    return { action, edge };
  }

  if (action === "reorder_siblings") {
    const parentId = requiredString(payload, "parent_node_id");
    const parent = getNode(data, parentId);
    requirePermission(data, parent.node_id, "create_child");
    const orderedNodeIds = Array.isArray(payload.ordered_node_ids)
      ? payload.ordered_node_ids.map(String)
      : [];
    const before = data.nodes
      .filter((node) => node.primary_parent_id === parentId)
      .sort(
        (left, right) =>
          left.sort_order - right.sort_order ||
          left.node_id.localeCompare(right.node_id),
      )
      .map((node) => node.node_id);
    const previewData = structuredClone(data);
    applySiblingOrder(previewData, parentId, orderedNodeIds);
    return {
      action,
      parent: { node_id: parent.node_id, name: parent.name },
      before,
      after: orderedNodeIds,
      parent_changes: false,
    };
  }

  const nodeId = requiredString(payload, "node_id");
  const node = getNode(data, nodeId);
  const childNodes = data.nodes.filter(
    (item) => item.primary_parent_id === nodeId,
  );
  const nodeDescendants = descendants(data, nodeId);
  const incoming = data.edges.filter((edge) => edge.to_node_id === nodeId);
  const outgoing = data.edges.filter((edge) => edge.from_node_id === nodeId);

  if (action === "create_content") {
    requirePermission(data, nodeId, "edit");
    if (node.status !== "active") {
      throw new Error("归档节点需先恢复，才能创建正文。");
    }
    if (node.content_path) {
      throw new Error("当前节点已经拥有正文，不能再创建第二份权威正文。");
    }
    const template = resolveContentTemplate(node, payload.content_template);
    return {
      action,
      node_id: nodeId,
      content_type: node.content_type,
      content_template: template,
      content_path: `content/private/subjects/physics/nodes/${node.node_id}${
        template === "raw_note" ? ".md" : ".mdx"
      }`,
      children_preserved: childNodes.length,
      relations_preserved: incoming.length + outgoing.length,
    };
  }

  if (action === "change_purpose") {
    requirePermission(data, nodeId, "edit");
    if (node.status !== "active") {
      throw new Error("归档节点需先恢复，才能修改用途。");
    }
    const nextPurpose = validatePurposeChange(data, node, payload.purpose);
    return {
      action,
      node_id: nodeId,
      before: { content_type: node.content_type },
      after: { content_type: nextPurpose },
      content_path: node.content_path,
      content_rewritten: false,
      children_preserved: childNodes.length,
      relations_preserved: incoming.length + outgoing.length,
    };
  }

  if (action === "rename") {
    requirePermission(data, nodeId, "edit");
    const name = requiredString(payload, "name");
    if (siblingNameConflict(data, node.primary_parent_id, name, nodeId)) {
      throw new Error("同一主要父节点下已经存在该正式名称。");
    }
    const aliases = Array.isArray(payload.aliases)
      ? payload.aliases.map(String).filter(Boolean)
      : node.aliases;
    if (aliasesConflict(data, node.primary_parent_id, aliases, nodeId)) {
      throw new Error("别名会在同一父节点下造成歧义。");
    }
    if (
      node.metadata?.immutable_archive === true &&
      payload.metadata &&
      typeof payload.metadata === "object" &&
      (payload.metadata as Record<string, unknown>).immutable_archive !== true
    ) {
      throw new Error("不可变原始归档的保护标记不能通过普通改名操作移除。");
    }
    return {
      action,
      node_id: nodeId,
      before: { name: node.name, aliases: node.aliases },
      after: {
        name,
        aliases,
        metadata:
          payload.metadata && typeof payload.metadata === "object"
            ? payload.metadata
            : node.metadata,
      },
      affected_direct_children: childNodes.length,
      identity_changes: false,
      route_changes: false,
      classification_event: false,
    };
  }

  if (action === "move" || action === "bulk_move") {
    const ids =
      action === "bulk_move" && Array.isArray(payload.node_ids)
        ? payload.node_ids.map(String)
        : [nodeId];
    const targetId = requiredString(payload, "target_parent_id");
    const target = getNode(data, targetId);
    for (const id of ids) {
      const moving = getNode(data, id);
      requirePermission(data, moving.node_id, "move");
      const decision = parentCandidateDecision(data, targetId, id);
      if (!decision.allowed) {
        throw new Error(`节点 ${id} 不能选择该父节点：${decision.reason}。`);
      }
      if (siblingNameConflict(data, targetId, moving.name, id)) {
        throw new Error(`目标父节点下已有同名节点：${moving.name}`);
      }
    }
    return {
      action,
      node_ids: ids,
      target_parent: { node_id: targetId, name: target.name },
      descendant_count: ids.reduce(
        (sum, id) => sum + descendants(data, id).length,
        0,
      ),
      old_permission_policies: Object.fromEntries(
        ids.map((id) => [
          id,
          getEffectivePermissionPolicy(id)?.permission_policy_id ?? null,
        ]),
      ),
      target_effective_permission:
        getEffectivePermissionPolicy(targetId)?.permission_policy_id ?? null,
      classification_evidence: boolValue(payload, "classification_evidence"),
    };
  }

  if (action === "delete_empty") {
    requirePermission(data, nodeId, "delete");
    if (childNodes.length || node.content_path || incoming.length || outgoing.length) {
      throw new Error(
        "只有无子节点、无内容文件、无入边和出边的空节点可以直接删除。",
      );
    }
  }

  if (action === "reorder") {
    requirePermission(data, nodeId, "move");
  }

  if (action === "archive" || action === "restore") {
    requirePermission(data, nodeId, "archive");
  }

  if (action === "change_permission") {
    requirePermission(data, nodeId, "manage_permissions");
  }

  if (action === "merge") {
    const targetId = requiredString(payload, "target_node_id");
    const target = getNode(data, targetId);
    if (target.node_id === node.node_id) throw new Error("不能合并同一节点。");
    requirePermission(data, node.node_id, "move");
    requirePermission(data, target.node_id, "create_child");
    const targetDecision = parentCandidateDecision(
      data,
      target.node_id,
      node.node_id,
    );
    if (!targetDecision.allowed) {
      throw new Error(`不能合并到目标节点：${targetDecision.reason}。`);
    }
    const sourceSummaries = childNodes.filter(
      (child) => child.content_type === "module_summary",
    );
    const targetSummaries = data.nodes.filter(
      (child) =>
        child.primary_parent_id === targetId &&
        child.content_type === "module_summary",
    );
    return {
      action,
      source: { node_id: nodeId, name: node.name },
      target: { node_id: targetId, name: target.name },
      children_to_move: childNodes.length,
      source_summary_count: sourceSummaries.length,
      target_summary_count: targetSummaries.length,
      summary_conflict: sourceSummaries.length > 0 && targetSummaries.length > 0,
      own_content_conflict: Boolean(node.content_path && target.content_path),
      behavior:
        "只迁移子节点和关系；来源节点及其正文归档保留，不静默覆盖目标正文。",
    };
  }

  if (action === "rekey") {
    requirePermission(data, nodeId, "rekey");
    const newId = requiredString(payload, "new_node_id");
    if (!isNodeId(newId)) throw new Error("新 ID 必须是8位数字。");
    if (data.nodes.some((item) => item.node_id === newId)) {
      throw new Error("新 ID 已存在。");
    }
    return {
      action,
      old_node_id: nodeId,
      new_node_id: newId,
      child_references: childNodes.length,
      incoming_edges: incoming.length,
      outgoing_edges: outgoing.length,
      content_path: node.content_path,
      canonical_route_before: `/nodes/${nodeId}`,
      canonical_route_after: `/nodes/${newId}`,
    };
  }

  return {
    action,
    node_id: nodeId,
    name: node.name,
    direct_children: childNodes.length,
    descendants: nodeDescendants.length,
    incoming_edges: incoming.length,
    outgoing_edges: outgoing.length,
    content_path: node.content_path,
  };
}

async function backupFiles(
  action: GraphAction,
  affectedContentPaths: string[],
) {
  const backupDir = path.join(
    graphBackupsRoot,
    `${nowStamp()}-${action}-${crypto.randomUUID().slice(0, 8)}`,
  );
  await fs.mkdir(backupDir, { recursive: true });
  const files = [
    nodesPath,
    edgesPath,
    policiesPath,
    idStatePath,
    legacyRouteMapPath,
    rekeyMapPath,
    graphAuditPath,
    problemIndexPath,
    moduleIndexPath,
    classificationLogPath,
    ...affectedContentPaths.map((item) => path.resolve(projectRoot, item)),
  ];
  for (const filePath of files) {
    try {
      const relative = path.relative(projectRoot, filePath);
      const target = path.join(backupDir, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(filePath, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return path.relative(projectRoot, backupDir).replaceAll("\\", "/");
}

async function appendAudit(event: GraphAuditEvent) {
  await fs.appendFile(graphAuditPath, `${JSON.stringify(event)}\n`, "utf8");
}

function auditType(action: GraphAction, classification: boolean): GraphAuditEventType {
  if (classification && (action === "move" || action === "bulk_move")) {
    return "problem_primary_parent_changed";
  }
  const mapping: Record<GraphAction, GraphAuditEventType> = {
    create: "node_created",
    create_content: "node_content_created",
    change_purpose: "node_purpose_changed",
    rename: "node_renamed",
    move: "node_moved",
    bulk_move: "nodes_bulk_moved",
    reorder: "node_reordered",
    reorder_siblings: "node_reordered",
    archive: "node_archived",
    restore: "node_restored",
    delete_empty: "node_deleted",
    merge: "node_merged",
    rekey: "node_rekeyed",
    create_edge: "edge_created",
    delete_edge: "edge_deleted",
    change_permission: "permission_changed",
  };
  return mapping[action];
}

export async function executeGraphAction(
  action: GraphAction,
  payload: GraphActionPayload,
  source: GraphAuditEvent["source"] = "admin_ui",
  expectedGraphVersion?: string,
) {
  const lock = await acquireGraphLock();
  if (expectedGraphVersion && getGraphVersion() !== expectedGraphVersion) {
    await lock.close();
    await fs.rm(graphWriteLockPath, { force: true });
    throw new GraphVersionConflictError();
  }
  const preview = previewGraphAction(action, payload);
  let backupPath: string | null = null;
  const beforeData = readGraphData();
  const data: GraphData = structuredClone(beforeData);
  const affectedNodeIds = new Set<string>();
  const affectedEdgeIds = new Set<string>();
  const changedContentNodes = new Set<string>();
  let idToRetire: string | null = null;
  let edgeIdToRetire: string | null = null;
  let specificIdToReserve: string | null = null;
  let classificationEventId: string | null = null;
  let classificationGuidanceWarning = "";
  const transactionOriginals = new Map<string, string | null>();
  let transactionCommitted = false;

  try {
    const touch = (node: GraphNode) => {
      node.updated_at = new Date().toISOString();
      affectedNodeIds.add(node.node_id);
    };

    if (action === "create") {
      const parentId = requiredString(payload, "parent_node_id");
      const parent = getNode(data, parentId);
      const spec = resolveCreateSpec(
        data,
        parent,
        payload.purpose,
        payload.create_content,
        payload.content_template,
      );
      const ids = await allocateGraphIds("node", 1);
      const timestamp = new Date().toISOString();
      const node: GraphNode = {
        node_id: ids[0],
        node_kind: spec.node_kind,
        content_type: spec.content_type,
        name: requiredString(payload, "name"),
        primary_parent_id: parentId,
        status: "active",
        sort_order:
          data.nodes.filter((item) => item.primary_parent_id === parentId).length +
          1,
        content_path: null,
        aliases: Array.isArray(payload.aliases)
          ? payload.aliases.map(String).filter(Boolean)
          : [],
        external_ids: [],
        permission_policy_id: parent.permission_policy_id,
        created_at: timestamp,
        updated_at: timestamp,
        metadata: {
          slug: optionalString(payload, "slug") || ids[0],
          classification_keywords: [],
          content_template: spec.content_template,
        },
      };
      data.nodes.push(node);
      touch(node);
      if (spec.create_content && spec.extension) {
        node.content_path = `content/private/subjects/physics/nodes/${node.node_id}${spec.extension}`;
        changedContentNodes.add(node.node_id);
      }
    } else if (action === "create_edge") {
      const edgeId = (await allocateGraphIds("edge", 1))[0];
      const edge: GraphEdge = {
        edge_id: edgeId,
        from_node_id: requiredString(payload, "from_node_id"),
        to_node_id: requiredString(payload, "to_node_id"),
        relation_type: requiredString(payload, "relation_type") as RelationType,
        metadata:
          payload.metadata && typeof payload.metadata === "object"
            ? (payload.metadata as Record<string, unknown>)
            : {},
        created_at: new Date().toISOString(),
      };
      data.edges.push(edge);
      affectedEdgeIds.add(edgeId);
    } else if (action === "delete_edge") {
      const edgeId = requiredString(payload, "edge_id");
      data.edges = data.edges.filter((edge) => edge.edge_id !== edgeId);
      edgeIdToRetire = edgeId;
      affectedEdgeIds.add(edgeId);
    } else if (action === "reorder_siblings") {
      const parentId = requiredString(payload, "parent_node_id");
      const orderedNodeIds = Array.isArray(payload.ordered_node_ids)
        ? payload.ordered_node_ids.map(String)
        : [];
      for (const node of applySiblingOrder(data, parentId, orderedNodeIds)) {
        touch(node);
      }
    } else {
      const nodeId = requiredString(payload, "node_id");
      const node = getNode(data, nodeId);
      if (action === "create_content") {
        if (node.content_path) {
          throw new Error("当前节点已经拥有正文。");
        }
        const template = resolveContentTemplate(node, payload.content_template);
        node.content_path = `content/private/subjects/physics/nodes/${node.node_id}${
          template === "raw_note" ? ".md" : ".mdx"
        }`;
        node.metadata = {
          ...(node.metadata ?? {}),
          content_template: template,
        };
        changedContentNodes.add(node.node_id);
        touch(node);
      } else if (action === "change_purpose") {
        const previousTemplate = resolveContentTemplate(
          node,
          node.metadata?.content_template ?? "purpose_default",
        );
        node.content_type = validatePurposeChange(data, node, payload.purpose);
        if (node.content_path) {
          node.metadata = {
            ...(node.metadata ?? {}),
            content_template: previousTemplate,
          };
        }
        if (node.content_path) changedContentNodes.add(node.node_id);
        touch(node);
      } else if (action === "rename") {
        const oldName = node.name;
        node.name = requiredString(payload, "name");
        node.aliases = Array.isArray(payload.aliases)
          ? payload.aliases.map(String).filter(Boolean)
          : node.aliases;
        if (boolValue(payload, "keep_old_name_as_alias") && !node.aliases.includes(oldName)) {
          node.aliases.push(oldName);
        }
        if (payload.metadata && typeof payload.metadata === "object") {
          node.metadata = payload.metadata as Record<string, unknown>;
        }
        touch(node);
        for (const child of data.nodes.filter(
          (item) => item.primary_parent_id === node.node_id,
        )) {
          if (child.content_path) changedContentNodes.add(child.node_id);
        }
      } else if (action === "move" || action === "bulk_move") {
        const ids =
          action === "bulk_move" && Array.isArray(payload.node_ids)
            ? payload.node_ids.map(String)
            : [nodeId];
        const targetId = requiredString(payload, "target_parent_id");
        let nextOrder =
          data.nodes.filter((item) => item.primary_parent_id === targetId).length +
          1;
        for (const id of ids) {
          const moving = getNode(data, id);
          moving.primary_parent_id = targetId;
          moving.sort_order = nextOrder++;
          touch(moving);
          if (moving.content_path) changedContentNodes.add(moving.node_id);
        }
      } else if (action === "reorder") {
        node.sort_order = Number(payload.sort_order);
        if (!Number.isFinite(node.sort_order)) throw new Error("排序值无效。");
        touch(node);
      } else if (action === "archive" || action === "restore") {
        node.status = action === "archive" ? "archived" : "active";
        touch(node);
      } else if (action === "delete_empty") {
        data.nodes = data.nodes.filter((item) => item.node_id !== nodeId);
        idToRetire = nodeId;
        affectedNodeIds.add(nodeId);
      } else if (action === "change_permission") {
        const policyId = requiredString(payload, "permission_policy_id");
        if (
          !data.permissionPolicies.some(
            (policy) => policy.permission_policy_id === policyId,
          )
        ) {
          throw new Error(`权限策略不存在：${policyId}`);
        }
        node.permission_policy_id = policyId;
        touch(node);
      } else if (action === "merge") {
        const target = getNode(data, requiredString(payload, "target_node_id"));
        const movingChildren = data.nodes.filter(
          (child) => child.primary_parent_id === node.node_id,
        );
        let order =
          data.nodes.filter((child) => child.primary_parent_id === target.node_id)
            .length + 1;
        for (const child of movingChildren) {
          child.primary_parent_id = target.node_id;
          child.sort_order = order++;
          touch(child);
          if (child.content_path) changedContentNodes.add(child.node_id);
        }
        for (const edge of data.edges) {
          if (edge.from_node_id === node.node_id) edge.from_node_id = target.node_id;
          if (edge.to_node_id === node.node_id) edge.to_node_id = target.node_id;
        }
        node.status = "archived";
        node.metadata = {
          ...(node.metadata ?? {}),
          merged_into_node_id: target.node_id,
        };
        touch(node);
        const supersedesId = (await allocateGraphIds("edge", 1))[0];
        data.edges.push({
          edge_id: supersedesId,
          from_node_id: target.node_id,
          to_node_id: node.node_id,
          relation_type: "supersedes",
          metadata: { merge_history: true },
          created_at: new Date().toISOString(),
        });
        affectedEdgeIds.add(supersedesId);
      } else if (action === "rekey") {
        const newId = requiredString(payload, "new_node_id");
        await reserveSpecificNodeId(newId);
        specificIdToReserve = newId;
        const oldId = node.node_id;
        node.node_id = newId;
        node.metadata = {
          ...(node.metadata ?? {}),
          legacy_node_ids: [
            ...((node.metadata?.legacy_node_ids as string[] | undefined) ?? []),
            oldId,
          ],
        };
        for (const child of data.nodes) {
          if (child.primary_parent_id === oldId) {
            child.primary_parent_id = newId;
            if (child.content_path) changedContentNodes.add(child.node_id);
          }
        }
        for (const edge of data.edges) {
          if (edge.from_node_id === oldId) edge.from_node_id = newId;
          if (edge.to_node_id === oldId) edge.to_node_id = newId;
        }
        if (node.content_path) changedContentNodes.add(newId);
        affectedNodeIds.add(oldId);
        touch(node);
        idToRetire = oldId;
      }
    }

    assertGraphValid(data, { checkContentFiles: false });
    const affectedPaths = [...changedContentNodes]
      .map((id) => data.nodes.find((node) => node.node_id === id)?.content_path)
      .filter((value): value is string => Boolean(value));
    backupPath = await backupFiles(action, affectedPaths);

    const transactionFiles = [
      nodesPath,
      edgesPath,
      legacyRouteMapPath,
      rekeyMapPath,
      problemIndexPath,
      moduleIndexPath,
      classificationLogPath,
      graphAuditPath,
      ...affectedPaths.map((item) => path.resolve(projectRoot, item)),
    ];
    for (const filePath of transactionFiles) {
      try {
        transactionOriginals.set(
          filePath,
          await fs.readFile(filePath, "utf8"),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          transactionOriginals.set(filePath, null);
        } else {
          throw error;
        }
      }
    }

    try {
      await writeAtomic(nodesPath, `${JSON.stringify(data.nodes, null, 2)}\n`);
      await writeAtomic(edgesPath, `${JSON.stringify(data.edges, null, 2)}\n`);
      if (action === "rekey") {
        const oldId = requiredString(payload, "node_id");
        const newId = requiredString(payload, "new_node_id");
        const rekeyMap = JSON.parse(
          await fs.readFile(rekeyMapPath, "utf8"),
        ) as Record<string, string>;
        rekeyMap[oldId] = newId;
        await writeAtomic(
          rekeyMapPath,
          `${JSON.stringify(rekeyMap, null, 2)}\n`,
        );
        const migratedLines = (
          await fs.readFile(classificationLogPath, "utf8")
        )
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => {
            const event = JSON.parse(line) as {
              before?: { parent_node_id?: string };
              after?: { parent_node_id?: string };
            };
            if (event.before?.parent_node_id === oldId) {
              event.before.parent_node_id = newId;
            }
            if (event.after?.parent_node_id === oldId) {
              event.after.parent_node_id = newId;
            }
            return JSON.stringify(event);
          });
        await writeAtomic(
          classificationLogPath,
          `${migratedLines.join("\n")}${migratedLines.length ? "\n" : ""}`,
        );
      }
      for (const nodeId of changedContentNodes) {
        const changedNode = getNode(data, nodeId);
        const parent = changedNode.primary_parent_id
          ? getNode(data, changedNode.primary_parent_id)
          : null;
        if (changedNode.content_path) {
          const absolute = path.resolve(projectRoot, changedNode.content_path);
          try {
            await fs.access(absolute);
          } catch {
            await fs.mkdir(path.dirname(absolute), { recursive: true });
            const initial = initialContentForCreatedNode(
              changedNode,
              parent,
            );
            await writeAtomic(absolute, initial);
          }
          await syncNodeContentIdentity(changedNode, parent);
        }
      }
      await rebuildDerivedIndexes(data);
      assertGraphValid(data);
      const classificationEvidence =
        boolValue(payload, "classification_evidence") &&
        (action === "move" || action === "bulk_move");
      if (classificationEvidence) {
        const movedIds =
          action === "bulk_move" && Array.isArray(payload.node_ids)
            ? payload.node_ids.map(String)
            : [requiredString(payload, "node_id")];
        for (const movedId of movedIds) {
          const beforeNode = beforeData.nodes.find(
            (item) => item.node_id === movedId,
          );
          const afterNode = data.nodes.find((item) => item.node_id === movedId);
          if (
            !beforeNode ||
            !afterNode ||
            beforeNode.content_type !== "problem_note" ||
            !beforeNode.content_path ||
            !afterNode.content_path ||
            !beforeNode.primary_parent_id ||
            !afterNode.primary_parent_id
          ) {
            continue;
          }
          const beforeParent = getNode(beforeData, beforeNode.primary_parent_id);
          const afterParent = getNode(data, afterNode.primary_parent_id);
          const absolute = path.resolve(projectRoot, afterNode.content_path);
          const sourceBefore =
            transactionOriginals.get(absolute) ??
            (await fs.readFile(absolute, "utf8"));
          const sourceAfter = await fs.readFile(absolute, "utf8");
          const document = matter(sourceAfter);
          const event = createProblemParentCorrectionEvent({
            filePath: absolute,
            contentId: String(
              document.data.id ??
                afterNode.metadata?.legacy_problem_id ??
                afterNode.node_id,
            ),
            anchorText: String(document.data.anchor_text ?? afterNode.name),
            sourceBefore,
            sourceAfter,
            beforeParent,
            afterParent,
            reason: optionalString(payload, "reason"),
          });
          if (event) {
            await appendClassificationCorrectionEvent(event);
            classificationEventId = event.event_id;
          }
        }
      }
    } catch (error) {
      for (const [filePath, content] of [
        ...transactionOriginals.entries(),
      ].reverse()) {
        if (content === null) {
          await fs.rm(filePath, { force: true }).catch(() => undefined);
        } else {
          await writeAtomic(filePath, content).catch(() => undefined);
        }
      }
      throw error;
    }
    transactionCommitted = true;

    if (idToRetire) await retireGraphId("node", idToRetire);
    if (edgeIdToRetire) await retireGraphId("edge", edgeIdToRetire);

    const classificationEvidence =
      boolValue(payload, "classification_evidence") &&
      (action === "move" || action === "bulk_move");
    const event: GraphAuditEvent = {
      event_id: crypto.randomUUID(),
      event_type: auditType(action, classificationEvidence),
      timestamp: new Date().toISOString(),
      source,
      success: true,
      actor: "local_admin",
      node_ids: [...affectedNodeIds],
      edge_ids: [...affectedEdgeIds],
      before: preview,
      after: {
        action,
        specific_id_reserved: specificIdToReserve,
      },
      impact: {
        affected_content_files: affectedPaths,
      },
      backup_path: backupPath,
      reason: optionalString(payload, "reason"),
      failure_reason: null,
      classification_evidence: classificationEvidence,
      test_event: source === "test",
      active: source !== "test",
    };
    await appendAudit(event);
    if (classificationEventId) {
      try {
        await buildClassificationGuidance();
      } catch (error) {
        classificationGuidanceWarning =
          error instanceof Error ? error.message : String(error);
      }
    }
    return {
      ok: true,
      preview,
      event,
      backupPath,
      classificationEventId,
      warning: classificationGuidanceWarning
        ? `分类事件已保存，但经验摘要刷新失败：${classificationGuidanceWarning}`
        : undefined,
      graphVersion: getGraphVersion(),
    };
  } catch (error) {
    if (transactionCommitted) {
      for (const [filePath, content] of [
        ...transactionOriginals.entries(),
      ].reverse()) {
        if (content === null) {
          await fs.rm(filePath, { force: true }).catch(() => undefined);
        } else {
          await writeAtomic(filePath, content).catch(() => undefined);
        }
      }
    }
    const failure: GraphAuditEvent = {
      event_id: crypto.randomUUID(),
      event_type: auditType(
        action,
        boolValue(payload, "classification_evidence"),
      ),
      timestamp: new Date().toISOString(),
      source,
      success: false,
      actor: "local_admin",
      node_ids: [...affectedNodeIds],
      edge_ids: [...affectedEdgeIds],
      before: preview,
      after: null,
      impact: {},
      backup_path: backupPath,
      reason: optionalString(payload, "reason"),
      failure_reason: error instanceof Error ? error.message : String(error),
      classification_evidence: false,
      test_event: source === "test",
      active: source !== "test",
    };
    await appendAudit(failure).catch(() => undefined);
    throw error;
  } finally {
    await lock.close();
    await fs.rm(graphWriteLockPath, { force: true });
  }
}
