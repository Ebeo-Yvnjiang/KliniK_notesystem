import { isEditableContentNode } from "./graph/content-access.ts";
import {
  getGraphNode,
  getGraphNodes,
  resolveContentPath,
} from "./graph/store.ts";

export type EditableTarget = { kind: "node"; id: string };

export function resolveEditableTarget(target: EditableTarget) {
  const node = getGraphNode(target.id);
  if (!node) throw new Error("节点不存在或不在图数据白名单中。");
  if (!isEditableContentNode(node, getGraphNodes())) {
    throw new Error("该节点不属于网页编辑器允许修改的正式物理内容。");
  }
  const filePath = resolveContentPath(node);
  if (!filePath) throw new Error("内容节点没有关联 Markdown/MDX 文件。");
  return { filePath, node };
}
