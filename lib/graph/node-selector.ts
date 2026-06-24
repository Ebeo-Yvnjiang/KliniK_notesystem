export type NodeSelectorItem = {
  node_id: string;
  name: string;
  path: string;
  status: string;
  unavailable_reason?: string;
};

export function filterNodeSelectorItems(
  items: NodeSelectorItem[],
  query: string,
  limit = 12,
) {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  if (!needle) return items.slice(0, limit);
  return items
    .filter((item) =>
      [item.node_id, item.name, item.path]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(needle),
    )
    .slice(0, limit);
}

export function resolveNodeSelectorInput(
  items: NodeSelectorItem[],
  input: string,
) {
  const value = input.trim();
  if (!value) {
    return { nodeId: "", item: null, error: "请选择节点。" };
  }
  if (/^\d+$/.test(value) && !/^\d{8}$/.test(value)) {
    return { nodeId: "", item: null, error: "节点ID必须是完整8位数字。" };
  }
  if (!/^\d{8}$/.test(value)) {
    return {
      nodeId: "",
      item: null,
      error: "请输入完整8位节点ID，或从名称搜索结果中选择节点。",
    };
  }
  const item = items.find((candidate) => candidate.node_id === value) ?? null;
  if (!item) {
    return { nodeId: "", item: null, error: "节点不存在。" };
  }
  if (item.unavailable_reason) {
    return { nodeId: "", item, error: item.unavailable_reason };
  }
  return { nodeId: item.node_id, item, error: "" };
}
