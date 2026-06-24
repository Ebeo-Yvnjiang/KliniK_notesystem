import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  classificationGuidancePath,
  classificationLogPath,
} from "../lib/classification-corrections.ts";
import {
  executeGraphAction as executeGraphActionRaw,
  previewGraphAction,
} from "../lib/graph/operations.ts";
import {
  edgesPath,
  legacyRouteMapPath,
  moduleIndexPath,
  nodesPath,
  problemIndexPath,
  projectRoot,
  idStatePath,
  rekeyMapPath,
} from "../lib/graph/paths.ts";
import { readGraphData } from "../lib/graph/store.ts";
import { assertGraphValid } from "../lib/graph/validation.ts";

const snapshotPaths = [
  nodesPath,
  edgesPath,
  legacyRouteMapPath,
  problemIndexPath,
  moduleIndexPath,
  classificationLogPath,
  classificationGuidancePath,
  rekeyMapPath,
];
const snapshots = new Map<string, string>();
for (const filePath of snapshotPaths) {
  snapshots.set(filePath, await fs.readFile(filePath, "utf8"));
}
const beforeFiles = new Set(
  await fs
    .readdir(
      path.join(projectRoot, "content", "private", "subjects", "physics", "nodes"),
    )
    .catch(() => []),
);
const originalData = readGraphData();
const physics = originalData.nodes.find((node) => node.content_type === "subject");
const testProblem = originalData.nodes.find(
  (node) => node.content_type === "problem_note" && Boolean(node.content_path),
);
const alternativeParent = originalData.nodes.find(
  (node) =>
    node.content_type === "module" &&
    node.node_id !== testProblem?.primary_parent_id,
);
if (!physics || !testProblem || !alternativeParent) {
  throw new Error("缺少图操作测试所需的现有节点。");
}
const originalProblemSource = await fs.readFile(
  path.join(projectRoot, testProblem.content_path!),
  "utf8",
);
const initialCorrectionLog = await fs.readFile(classificationLogPath, "utf8");
const operationBackups: string[] = [];
const executeGraphAction = (
  ...args: Parameters<typeof executeGraphActionRaw>
) => executeGraphActionRaw(args[0], args[1], "test", args[3]);

function rememberBackup(result: { backupPath?: string | null }) {
  if (result.backupPath) operationBackups.push(result.backupPath);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const level1 = await executeGraphAction("create", {
    parent_node_id: physics.node_id,
    name: "__验收一级容器__",
    purpose: "module",
    create_content: false,
  });
  rememberBackup(level1);
  const level1Id = level1.event.node_ids[0];
  const level2 = await executeGraphAction("create", {
    parent_node_id: level1Id,
    name: "__验收二级容器__",
    purpose: "module",
    create_content: false,
  });
  rememberBackup(level2);
  const level2Id = level2.event.node_ids[0];
  const level3 = await executeGraphAction("create", {
    parent_node_id: level2Id,
    name: "__验收三级容器__",
    purpose: "module",
    create_content: false,
  });
  rememberBackup(level3);
  const level3Id = level3.event.node_ids[0];
  const content = await executeGraphAction("create", {
    parent_node_id: level3Id,
    name: "__验收临时内容__",
    purpose: "problem_note",
    create_content: true,
  });
  rememberBackup(content);
  const contentId = content.event.node_ids[0];
  assert(
    readGraphData().nodes.find((node) => node.node_id === contentId)
      ?.primary_parent_id === level3Id,
    "三层容器中的内容归属错误。",
  );

  const childUnderProblem = await executeGraphAction("create", {
    parent_node_id: contentId,
    name: "__题目节点下的子节点__",
    purpose: "module",
    create_content: false,
  });
  rememberBackup(childUnderProblem);
  assert(
    readGraphData().nodes.find(
      (node) => node.node_id === childUnderProblem.event.node_ids[0],
    )?.primary_parent_id === contentId,
    "带正文的题目节点不能成为父节点。",
  );

  const summaryNode = await executeGraphAction("create", {
    parent_node_id: contentId,
    name: "__可嵌套总结节点__",
    purpose: "module_summary",
    create_content: true,
  });
  rememberBackup(summaryNode);
  const summaryId = summaryNode.event.node_ids[0];
  const childUnderSummary = await executeGraphAction("create", {
    parent_node_id: summaryId,
    name: "__总结节点下的子节点__",
    purpose: "module",
    create_content: false,
  });
  rememberBackup(childUnderSummary);
  const summaryEdge = await executeGraphAction("create_edge", {
    from_node_id: summaryId,
    to_node_id: contentId,
    relation_type: "supports",
  });
  rememberBackup(summaryEdge);
  assert(
    readGraphData().nodes.some(
      (node) =>
        node.node_id === childUnderSummary.event.node_ids[0] &&
        node.primary_parent_id === summaryId,
    ) &&
      readGraphData().edges.some(
        (edge) => edge.edge_id === summaryEdge.event.edge_ids[0],
      ),
    "总结节点未获得统一的子节点或关系能力。",
  );

  const contentForContainer = await executeGraphAction("create_content", {
    node_id: level1Id,
    content_template: "generic",
    reason: "统一节点能力验收",
  });
  rememberBackup(contentForContainer);
  const level1WithContent = readGraphData().nodes.find(
    (node) => node.node_id === level1Id,
  )!;
  assert(
    level1WithContent.node_kind === "container" &&
      Boolean(level1WithContent.content_path),
    "旧容器节点未能按需创建正文，或错误依赖node_kind改变能力。",
  );
  const level1Path = path.join(projectRoot, level1WithContent.content_path!);
  const beforePurposeSource = await fs.readFile(level1Path, "utf8");
  const beforePurposeBody = matter(beforePurposeSource).content;
  const purposeChanged = await executeGraphAction("change_purpose", {
    node_id: level1Id,
    purpose: "raw_note",
    reason: "统一节点用途验收",
  });
  rememberBackup(purposeChanged);
  const afterPurposeSource = await fs.readFile(level1Path, "utf8");
  assert(
    matter(afterPurposeSource).content === beforePurposeBody,
    "用途变化改写了已有正文。",
  );
  const purposeRestored = await executeGraphAction("change_purpose", {
    node_id: level1Id,
    purpose: "module",
    reason: "恢复测试用途",
  });
  rememberBackup(purposeRestored);

  const rename = await executeGraphAction("rename", {
    node_id: level2Id,
    name: "__验收二级容器已改名__",
    keep_old_name_as_alias: true,
  });
  rememberBackup(rename);
  assert(
    readGraphData().nodes.find((node) => node.node_id === level2Id)?.name ===
      "__验收二级容器已改名__",
    "容器改名未生效。",
  );

  const moveProblem = await executeGraphAction("move", {
    node_id: testProblem.node_id,
    target_parent_id: alternativeParent.node_id,
    classification_evidence: false,
    reason: "图操作验收：结构移动，不进入分类经验",
  });
  rememberBackup(moveProblem);
  assert(
    readGraphData().nodes.find((node) => node.node_id === testProblem.node_id)
      ?.primary_parent_id === alternativeParent.node_id,
    "测试题移动失败。",
  );
  const moveBack = await executeGraphAction("move", {
    node_id: testProblem.node_id,
    target_parent_id: testProblem.primary_parent_id!,
    classification_evidence: false,
    reason: "图操作验收：恢复原归属",
  });
  rememberBackup(moveBack);
  assert(
    readGraphData().nodes.find((node) => node.node_id === testProblem.node_id)
      ?.primary_parent_id === testProblem.primary_parent_id,
    "测试题未恢复原归属。",
  );
  assert(
    (await fs.readFile(classificationLogPath, "utf8")) === initialCorrectionLog,
    "普通结构移动污染了分类修正日志。",
  );

  let cycleBlocked = false;
  try {
    previewGraphAction("move", {
      node_id: level1Id,
      target_parent_id: level3Id,
    });
  } catch {
    cycleBlocked = true;
  }
  assert(cycleBlocked, "没有阻止父节点移入后代。");

  const secondContent = await executeGraphAction("create", {
    parent_node_id: level3Id,
    name: "__验收第二内容__",
    purpose: "problem_note",
    create_content: true,
  });
  rememberBackup(secondContent);
  const secondContentId = secondContent.event.node_ids[0];
  const edge1 = await executeGraphAction("create_edge", {
    from_node_id: testProblem.node_id,
    to_node_id: contentId,
    relation_type: "cites",
  });
  rememberBackup(edge1);
  const anotherProblem = originalData.nodes.find(
    (node) =>
      node.content_type === "problem_note" &&
      node.node_id !== testProblem.node_id,
  )!;
  const edge2 = await executeGraphAction("create_edge", {
    from_node_id: anotherProblem.node_id,
    to_node_id: contentId,
    relation_type: "cites",
  });
  rememberBackup(edge2);
  const deleteOneEdge = await executeGraphAction("delete_edge", {
    edge_id: edge1.event.edge_ids[0],
  });
  rememberBackup(deleteOneEdge);
  assert(
    readGraphData().edges.some(
      (edge) =>
        edge.from_node_id === anotherProblem.node_id &&
        edge.to_node_id === contentId &&
        edge.relation_type === "cites",
    ),
    "删除一条引用错误影响另一条引用。",
  );

  const acyclic1 = await executeGraphAction("create_edge", {
    from_node_id: contentId,
    to_node_id: secondContentId,
    relation_type: "derived_from",
  });
  rememberBackup(acyclic1);
  let relationCycleBlocked = false;
  try {
    await executeGraphAction("create_edge", {
      from_node_id: secondContentId,
      to_node_id: contentId,
      relation_type: "derived_from",
    });
  } catch {
    relationCycleBlocked = true;
  }
  assert(relationCycleBlocked, "没有阻止derived_from循环。");

  const related1 = await executeGraphAction("create_edge", {
    from_node_id: contentId,
    to_node_id: secondContentId,
    relation_type: "related_to",
  });
  rememberBackup(related1);
  const related2 = await executeGraphAction("create_edge", {
    from_node_id: secondContentId,
    to_node_id: contentId,
    relation_type: "related_to",
  });
  rememberBackup(related2);

  const bulkA = await executeGraphAction("create", {
    parent_node_id: level3Id,
    name: "__批量A__",
    purpose: "module",
    create_content: false,
  });
  const bulkB = await executeGraphAction("create", {
    parent_node_id: level3Id,
    name: "__批量B__",
    purpose: "module",
    create_content: false,
  });
  rememberBackup(bulkA);
  rememberBackup(bulkB);
  const bulk = await executeGraphAction("bulk_move", {
    node_id: bulkA.event.node_ids[0],
    node_ids: [bulkA.event.node_ids[0], bulkB.event.node_ids[0]],
    target_parent_id: level2Id,
  });
  rememberBackup(bulk);

  const reordered = await executeGraphAction("reorder", {
    node_id: bulkA.event.node_ids[0],
    sort_order: 42,
  });
  rememberBackup(reordered);
  const archived = await executeGraphAction("archive", {
    node_id: bulkB.event.node_ids[0],
  });
  rememberBackup(archived);
  const restored = await executeGraphAction("restore", {
    node_id: bulkB.event.node_ids[0],
  });
  rememberBackup(restored);

  const mergeSource = await executeGraphAction("create", {
    parent_node_id: level1Id,
    name: "__合并来源__",
    purpose: "module",
    create_content: false,
  });
  const mergeTarget = await executeGraphAction("create", {
    parent_node_id: level1Id,
    name: "__合并目标__",
    purpose: "module",
    create_content: false,
  });
  rememberBackup(mergeSource);
  rememberBackup(mergeTarget);
  const merged = await executeGraphAction("merge", {
    node_id: mergeSource.event.node_ids[0],
    target_node_id: mergeTarget.event.node_ids[0],
    reason: "图操作验收",
  });
  rememberBackup(merged);

  const emptyForRekey = await executeGraphAction("create", {
    parent_node_id: level1Id,
    name: "__改ID节点__",
    purpose: "module",
    create_content: false,
  });
  rememberBackup(emptyForRekey);
  const idState = JSON.parse(await fs.readFile(idStatePath, "utf8")) as {
    next_node_id: number;
  };
  const newNodeId = String(idState.next_node_id + 10).padStart(8, "0");
  const rekeyed = await executeGraphAction("rekey", {
    node_id: emptyForRekey.event.node_ids[0],
    new_node_id: newNodeId,
    reason: "图操作验收",
  });
  rememberBackup(rekeyed);
  assert(
    readGraphData().nodes.some((node) => node.node_id === newNodeId),
    "ID修改未生效。",
  );

  const emptyToDelete = await executeGraphAction("create", {
    parent_node_id: level1Id,
    name: "__删除空节点__",
    purpose: "module",
    create_content: false,
  });
  rememberBackup(emptyToDelete);
  const deleted = await executeGraphAction("delete_empty", {
    node_id: emptyToDelete.event.node_ids[0],
  });
  rememberBackup(deleted);

  const permissionPreview = previewGraphAction("change_permission", {
    node_id: level1Id,
    permission_policy_id: "owner-full-control",
  });
  assert(Boolean(permissionPreview), "权限变更预览失败。");
  assertGraphValid(readGraphData());

  console.log(
    JSON.stringify(
      {
        nestedContainers: 3,
        problemNodeCanParent: true,
        summaryNodeCanParentAndRelate: true,
        containerContentCreatedOnDemand: true,
        purposeChangePreservedBody: true,
        contentMovedAndRestored: true,
        renameStableId: level2Id,
        sharedReferenceIndependent: true,
        primaryCycleBlocked: true,
        acyclicRelationCycleBlocked: true,
        relatedCycleAllowed: true,
        bulkMove: true,
        archiveRestore: true,
        merge: true,
        rekey: true,
        deleteEmpty: true,
        classificationLogUnchanged: true,
      },
      null,
      2,
    ),
  );
} finally {
  for (const [filePath, source] of snapshots) {
    await fs.writeFile(filePath, source, "utf8");
  }
  await fs.writeFile(
    path.join(projectRoot, testProblem.content_path!),
    originalProblemSource,
    "utf8",
  );
  const nodeContentDir = path.join(
    projectRoot,
    "content",
    "private",
    "subjects",
    "physics",
    "nodes",
  );
  const afterFiles = await fs.readdir(nodeContentDir).catch(() => []);
  for (const file of afterFiles) {
    if (!beforeFiles.has(file)) {
      await fs.rm(path.join(nodeContentDir, file), { force: true });
    }
  }
}
