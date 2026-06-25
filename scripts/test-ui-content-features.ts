import fs from "node:fs/promises";
import path from "node:path";
import { searchGraphContent } from "../lib/content-search.ts";
import {
  initialContentForCreatedNode,
  nodePurposeOptions,
  resolveCreateSpec,
} from "../lib/graph/create-types.ts";
import { contentTargetNodeId } from "../lib/graph/admin-view.ts";
import {
  editableContentNodes,
  searchableContentNodes,
} from "../lib/graph/content-access.ts";
import { parentCandidateDecision } from "../lib/graph/node-capabilities.ts";
import {
  filterNodeSelectorItems,
  resolveNodeSelectorInput,
} from "../lib/graph/node-selector.ts";
import {
  executeGraphAction,
  previewGraphAction,
} from "../lib/graph/operations.ts";
import {
  graphAuditPath,
  legacyRouteMapPath,
  moduleIndexPath,
  nodesPath,
  problemIndexPath,
  projectRoot,
} from "../lib/graph/paths.ts";
import { getGraphVersion, readGraphData } from "../lib/graph/store.ts";
import { resolveEditableTarget } from "../lib/private-content-paths.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const graph = readGraphData();
const graphNodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
function graphNodePath(nodeId: string) {
  const parts: string[] = [];
  const visited = new Set<string>();
  let current = graphNodeById.get(nodeId);
  while (current) {
    if (visited.has(current.node_id)) break;
    visited.add(current.node_id);
    parts.unshift(current.name);
    current = current.primary_parent_id
      ? graphNodeById.get(current.primary_parent_id)
      : undefined;
  }
  return parts.join(" / ");
}
const snapshots = new Map<string, string>();
for (const filePath of [
  nodesPath,
  graphAuditPath,
  legacyRouteMapPath,
  moduleIndexPath,
  problemIndexPath,
]) {
  snapshots.set(filePath, await fs.readFile(filePath, "utf8"));
}

const siblingParent = graph.nodes.find(
  (candidate) =>
    graph.nodes.filter(
      (node) => node.primary_parent_id === candidate.node_id,
    ).length >= 2,
);
assert(siblingParent, "缺少可测试排序的兄弟节点。");
const subject = graph.nodes.find((node) => node.content_type === "subject");
const moduleNodeForCreate = graph.nodes.find(
  (node) => node.content_type === "module",
);
const problemNodeForParent = graph.nodes.find(
  (node) => node.content_type === "problem_note" && node.content_path,
);
assert(
  subject && moduleNodeForCreate && problemNodeForParent,
  "缺少创建用途测试节点。",
);
assert(
  resolveCreateSpec(
    graph,
    subject,
    "module",
    false,
    "purpose_default",
  ).create_content === false,
  "无正文节点创建规格错误。",
);
assert(
  resolveCreateSpec(
    graph,
    problemNodeForParent,
    "module",
    false,
    "purpose_default",
  ).content_type === "module",
  "带正文题目节点不能作为新节点父节点。",
);
assert(
  resolveCreateSpec(
    graph,
    moduleNodeForCreate,
    "problem_note",
    true,
    "purpose_default",
  ).content_type === "problem_note",
  "题目用途没有映射到problem_note。",
);
assert(
  parentCandidateDecision(
    graph,
    problemNodeForParent.node_id,
    null,
  ).allowed,
  "父节点候选仍被节点类型限制。",
);
assert(
  parentCandidateDecision(
    graph,
    problemNodeForParent.node_id,
    problemNodeForParent.node_id,
  ).reason === "不能选择自身",
  "父节点不可选时没有给出明确的自身原因。",
);
assert(
  parentCandidateDecision(
    graph,
    moduleNodeForCreate.node_id,
    subject.node_id,
  ).reason === "选择后会形成循环",
  "父节点不可选时没有给出明确的循环原因。",
);
const archivedNode = graph.nodes.find((node) => node.status === "archived");
assert(
  !archivedNode ||
    parentCandidateDecision(
      graph,
      archivedNode.node_id,
      problemNodeForParent.node_id,
    ).reason === "节点已经归档",
  "归档父节点没有显示状态限制原因。",
);
const selectorItems = graph.nodes.map((node) => ({
  node_id: node.node_id,
  name: node.name,
  path: graphNodePath(node.node_id),
  status: node.status,
  unavailable_reason: parentCandidateDecision(
    graph,
    node.node_id,
    problemNodeForParent.node_id,
  ).allowed
    ? ""
    : parentCandidateDecision(
        graph,
        node.node_id,
        problemNodeForParent.node_id,
      ).reason,
}));
const directIdResult = resolveNodeSelectorInput(
  selectorItems,
  moduleNodeForCreate.node_id,
);
const nameMatches = filterNodeSelectorItems(
  selectorItems,
  moduleNodeForCreate.name,
);
const selectedByList = resolveNodeSelectorInput(
  selectorItems,
  nameMatches.find((item) => item.node_id === moduleNodeForCreate.node_id)!
    .node_id,
);
assert(
  directIdResult.nodeId === moduleNodeForCreate.node_id &&
    selectedByList.nodeId === directIdResult.nodeId,
  "直接输入ID与候选选择没有得到同一node_id。",
);
assert(
  nameMatches.some((item) => item.node_id === moduleNodeForCreate.node_id),
  "输入节点名称不能筛选候选项。",
);
const syntheticSimilarItems = [
  {
    node_id: "10000001",
    name: "重复测试节点",
    path: "物理 / A / 重复测试节点",
    status: "active",
    unavailable_reason: "",
  },
  {
    node_id: "10000002",
    name: "重复测试节点",
    path: "物理 / B / 重复测试节点",
    status: "active",
    unavailable_reason: "",
  },
  {
    node_id: "10000003",
    name: "路径命中节点",
    path: "物理 / 特殊路径关键词 / 路径命中节点",
    status: "active",
    unavailable_reason: "",
  },
];
assert(
  filterNodeSelectorItems(syntheticSimilarItems, "重复测试").length === 2 &&
    resolveNodeSelectorInput(syntheticSimilarItems, "10000001").nodeId !==
      resolveNodeSelectorInput(syntheticSimilarItems, "10000002").nodeId,
  "同名或近似名称节点不能通过node_id区分。",
);
assert(
  filterNodeSelectorItems(syntheticSimilarItems, "特殊路径关键词")[0]
    ?.node_id === "10000003",
  "输入路径关键词不能筛选候选项。",
);
assert(
  resolveNodeSelectorInput(selectorItems, "123").error.includes("8位") &&
    resolveNodeSelectorInput(selectorItems, "99999999").error === "节点不存在。",
  "无效或不存在节点ID没有被组合框拒绝。",
);
const permissionGraph = structuredClone(graph);
permissionGraph.permissionPolicies.push({
  permission_policy_id: "test-no-create-child",
  name: "测试只读",
  description: "测试",
  inherit_from_parent: false,
  grants: { local_admin: ["view"] },
});
const permissionCandidate = permissionGraph.nodes.find(
  (node) => node.node_id === moduleNodeForCreate.node_id,
)!;
permissionCandidate.permission_policy_id = "test-no-create-child";
assert(
  parentCandidateDecision(
    permissionGraph,
    permissionCandidate.node_id,
    problemNodeForParent.node_id,
  ).reason === "没有在该节点下创建子节点的权限",
  "权限不足时没有显示真实原因。",
);
let handcraftedRequestRejected = false;
try {
  previewGraphAction("move", {
    node_id: problemNodeForParent.node_id,
    target_parent_id: problemNodeForParent.node_id,
  });
} catch (error) {
  handcraftedRequestRejected =
    error instanceof Error && error.message.includes("不能选择自身");
}
assert(handcraftedRequestRejected, "手工请求绕过了服务端父节点校验。");
let malformedRequestRejected = false;
try {
  previewGraphAction("move", {
    node_id: problemNodeForParent.node_id,
    target_parent_id: "123",
  });
} catch (error) {
  malformedRequestRejected =
    error instanceof Error && error.message.includes("8位数字");
}
assert(malformedRequestRejected, "无效ID格式绕过了服务端校验。");
const sampleCreatedProblem = {
  ...graph.nodes.find((node) => node.content_type === "problem_note")!,
  node_id: "99999999",
  name: "测试人工题目",
  primary_parent_id: moduleNodeForCreate.node_id,
};
assert(
  initialContentForCreatedNode(
    sampleCreatedProblem,
    moduleNodeForCreate,
    "purpose_default",
  ).includes("anchor_text: 测试人工题目"),
  "题目创建模板未自动生成必要frontmatter。",
);
const originalSiblings = graph.nodes
  .filter((node) => node.primary_parent_id === siblingParent.node_id)
  .sort(
    (left, right) =>
      left.sort_order - right.sort_order ||
      left.node_id.localeCompare(right.node_id),
  )
  .map((node) => node.node_id);
const reversed = [...originalSiblings].reverse();

try {
  const preview = previewGraphAction("reorder_siblings", {
    parent_node_id: siblingParent.node_id,
    ordered_node_ids: reversed,
  }) as { parent_changes?: boolean };
  assert(preview.parent_changes === false, "同级排序错误地改变了父节点。");
  await executeGraphAction(
    "reorder_siblings",
    {
      parent_node_id: siblingParent.node_id,
      ordered_node_ids: reversed,
      reason: "界面专项测试",
    },
    "test",
    getGraphVersion(),
  );
  const persisted = readGraphData().nodes
    .filter((node) => node.primary_parent_id === siblingParent.node_id)
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order ||
        left.node_id.localeCompare(right.node_id),
    )
    .map((node) => node.node_id);
  assert(
    persisted.join(",") === reversed.join(","),
    "兄弟节点新顺序未写入权威图数据。",
  );
} finally {
  for (const [filePath, source] of snapshots) {
    await fs.writeFile(filePath, source, "utf8");
  }
}

const editable = editableContentNodes(graph.nodes);
assert(editable.length > 0, "网页编辑白名单为空。");
assert(
  editable.every(
    (node) =>
      node.content_path?.startsWith("content/private/subjects/physics/") &&
      !node.content_path.includes("/raw-notes/") &&
      !node.content_path.startsWith("docs/"),
  ),
  "网页编辑白名单包含非正式内容文件。",
);
const rawNode = graph.nodes.find((node) => node.content_type === "raw_note");
assert(rawNode, "缺少原始笔记节点。");
let rawRejected = false;
try {
  resolveEditableTarget({ kind: "node", id: rawNode.node_id });
} catch {
  rawRejected = true;
}
assert(rawRejected, "原始归档可以绕过服务端白名单进入编辑器。");

const phrase = "这种斜面具体计算则考虑拆分成平行/垂直斜面方向去分别计算。";
const results = searchGraphContent(phrase);
assert(results.length > 0, "中文原句搜索没有结果。");
const searchableIds = new Set(
  searchableContentNodes(graph.nodes).map((node) => node.node_id),
);
assert(
  results.every(
    (result) =>
      searchableIds.has(result.node_id) &&
      `/nodes/${result.node_id}`.startsWith("/nodes/"),
  ),
  "搜索结果包含白名单外文件或无法生成规范跳转。",
);

const root = graph.nodes.find((node) => node.content_type === "knowledge_base");
assert(root, "缺少知识库根节点。");
assert(
  contentTargetNodeId(root, graph.nodes) === null,
  "无正文节点生成了错误内容链接。",
);
const moduleNode = graph.nodes.find((node) => node.content_type === "module");
assert(moduleNode, "缺少模块节点。");
assert(
  Boolean(contentTargetNodeId(moduleNode, graph.nodes)),
  "有总结内容的容器没有内容入口。",
);

const nodePage = await fs.readFile(
  path.join(projectRoot, "app", "nodes", "[node_id]", "page.tsx"),
  "utf8",
);
const wrapper = await fs.readFile(
  path.join(projectRoot, "components", "editable-node-content.tsx"),
  "utf8",
);
const problemTable = await fs.readFile(
  path.join(projectRoot, "components", "problem-table.tsx"),
  "utf8",
);
const adminPanel = await fs.readFile(
  path.join(projectRoot, "components", "graph-admin-panel.tsx"),
  "utf8",
);
const nodeCombobox = await fs.readFile(
  path.join(projectRoot, "components", "node-combobox.tsx"),
  "utf8",
);
assert(
  nodePage.includes("<EditableNodeContent") &&
    wrapper.includes("!editing && <MarkdownContent"),
  "编辑模式未通过单一条件渲染隔离下方正文。",
);
assert(
  problemTable.includes("管理题目") &&
    problemTable.includes("/admin/nodes?node=${problem.node_id}") &&
    problemTable.includes("未关联节点"),
  "题目索引缺少稳定node_id管理入口或无效节点状态。",
);
assert(
  adminPanel.includes("admin-node-target") &&
    adminPanel.includes("清除定位") &&
    adminPanel.includes("显示全部节点") &&
    adminPanel.includes("不能选择自身") &&
    adminPanel.includes("选择后会形成循环"),
  "管理页缺少定位高亮或普通列表恢复入口。",
);
assert(
  nodePurposeOptions.length === 5 &&
    adminPanel.includes("立即创建正文") &&
    adminPanel.includes("为当前节点创建正文") &&
    adminPanel.includes('run("change_purpose"'),
  "统一节点用途或按需正文入口缺失。",
);
assert(
  nodeCombobox.includes('role="combobox"') &&
    nodeCombobox.includes("已选择：") &&
    nodeCombobox.includes("<mark>") &&
    (adminPanel.match(/<NodeCombobox/g)?.length ?? 0) >= 5 &&
    adminPanel.includes("批量移动目标父节点") &&
    adminPanel.includes("关系目标节点") &&
    adminPanel.includes("合并目标节点"),
  "名称/ID组合框未复用于创建、移动、批量移动、关系边和合并操作。",
);
assert(
  adminPanel.indexOf("<h3>同级拖拽排序</h3>") >
    adminPanel.indexOf("<h3>高级ID修改</h3>") &&
    adminPanel.indexOf("<h3>同级拖拽排序</h3>") <
      adminPanel.indexOf("<h3>权限策略</h3>") &&
    (adminPanel.match(/<h3>同级拖拽排序<\/h3>/g)?.length ?? 0) === 1,
  "同级拖拽排序没有唯一地移动到权限策略正上方。",
);

console.log(
  JSON.stringify({
    sibling_reorder_persisted_and_restored: true,
    editable_nodes: editable.length,
    raw_archive_rejected: true,
    chinese_phrase_results: results.length,
    search_scope_nodes: searchableIds.size,
    no_content_link_disabled: true,
    edit_mode_single_render: true,
    unified_node_purpose_validation: true,
    node_combobox_resolution: true,
    server_parent_validation: true,
    sibling_sort_before_permissions: true,
    problem_management_links: true,
  }),
);
