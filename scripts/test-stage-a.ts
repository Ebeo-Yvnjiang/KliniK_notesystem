import fs from "node:fs/promises";
import path from "node:path";
import { restoreGraphBackup } from "../lib/graph/backups.ts";
import {
  executeGraphAction,
  GraphVersionConflictError,
} from "../lib/graph/operations.ts";
import { problemIndexPath, projectRoot } from "../lib/graph/paths.ts";
import {
  getGraphVersion,
  readGraphData,
} from "../lib/graph/store.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const original = readGraphData();
const originalNodeIds = original.nodes.map((node) => node.node_id).sort();
const originalEdgeIds = original.edges.map((edge) => edge.edge_id).sort();
const problem = original.nodes.find(
  (node) => node.content_type === "problem_note" && node.status === "active",
);
const physics = original.nodes.find((node) => node.content_type === "subject");
assert(problem && physics, "缺少阶段A测试节点。");

const staleVersion = getGraphVersion();
await executeGraphAction(
  "archive",
  { node_id: problem.node_id, reason: "阶段A归档过滤测试" },
  "test",
  staleVersion,
);
const archivedIndex = JSON.parse(
  await fs.readFile(problemIndexPath, "utf8"),
) as { node_id: string }[];
assert(
  !archivedIndex.some((item) => item.node_id === problem.node_id),
  "归档题目仍出现在普通索引。",
);

let conflictRejected = false;
try {
  await executeGraphAction(
    "restore",
    { node_id: problem.node_id, reason: "阶段A过期版本测试" },
    "test",
    staleVersion,
  );
} catch (error) {
  conflictRejected = error instanceof GraphVersionConflictError;
}
assert(conflictRejected, "过期图版本未被拒绝。");

await executeGraphAction(
  "restore",
  { node_id: problem.node_id, reason: "阶段A归档恢复测试" },
  "test",
  getGraphVersion(),
);
const restoredIndex = JSON.parse(
  await fs.readFile(problemIndexPath, "utf8"),
) as { node_id: string }[];
assert(
  restoredIndex.some((item) => item.node_id === problem.node_id),
  "恢复题目未重新进入普通索引。",
);

const created = await executeGraphAction(
  "create",
  {
    parent_node_id: physics.node_id,
    name: "__阶段A备份恢复测试__",
    purpose: "module",
    create_content: false,
  },
  "test",
  getGraphVersion(),
);
assert(created.backupPath, "临时创建操作没有备份。");
assert(
  readGraphData().nodes.some((node) => node.name === "__阶段A备份恢复测试__"),
  "临时节点创建失败。",
);
await restoreGraphBackup(created.backupPath, getGraphVersion(), "test");

const finalData = readGraphData();
assert(
  !finalData.nodes.some((node) => node.name === "__阶段A备份恢复测试__"),
  "备份恢复后临时节点仍存在。",
);
assert(
  JSON.stringify(finalData.nodes.map((node) => node.node_id).sort()) ===
    JSON.stringify(originalNodeIds),
  "备份恢复后节点ID集合发生变化。",
);
assert(
  JSON.stringify(finalData.edges.map((edge) => edge.edge_id).sort()) ===
    JSON.stringify(originalEdgeIds),
  "备份恢复后边ID集合发生变化。",
);
console.log(
  JSON.stringify({
    archived_problem_hidden: true,
    restored_problem_visible: true,
    stale_version_rejected: true,
    backup_restore_passed: true,
    node_count: finalData.nodes.length,
    edge_count: finalData.edges.length,
    problem_index_count: restoredIndex.length,
    cwd: path.relative(projectRoot, process.cwd()) || ".",
  }),
);
