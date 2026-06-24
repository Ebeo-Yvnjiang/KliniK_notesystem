import matter from "gray-matter";
import type { GraphData, GraphNode } from "./types.ts";

export type NodePurpose =
  | "module"
  | "problem_note"
  | "module_summary"
  | "raw_note"
  | "unassigned_fragments";

export type ContentTemplate = "purpose_default" | "generic";

export const nodePurposeOptions: {
  value: NodePurpose;
  label: string;
  description: string;
}[] = [
  {
    value: "module",
    label: "模块或组织节点",
    description: "用于组织内容；是否有正文不影响它继续拥有子节点和关系。",
  },
  {
    value: "problem_note",
    label: "题目笔记",
    description: "用于题目索引、题目卡模板和相关统计。",
  },
  {
    value: "module_summary",
    label: "模块总结",
    description: "用于知识总结模板和模块总结入口。",
  },
  {
    value: "unassigned_fragments",
    label: "未归属内容",
    description: "用于暂未完成归属判断的内容片段。",
  },
  {
    value: "raw_note",
    label: "原始笔记或归档",
    description: "用于标识原始来源或归档用途；只读保护由节点元数据单独决定。",
  },
];

export const contentTemplateOptions: {
  value: ContentTemplate;
  label: string;
  description: string;
}[] = [
  {
    value: "purpose_default",
    label: "按节点用途初始化",
    description: "题目、总结等用途使用现有专用模板；模块使用普通正文模板。",
  },
  {
    value: "generic",
    label: "普通正文",
    description: "只创建标题和基础frontmatter，不写入题目或总结专用章节。",
  },
];

export type CreateSpec = {
  purpose: NodePurpose;
  create_content: boolean;
  content_template: ContentTemplate;
  node_kind: "container" | "content";
  content_type: NodePurpose;
  extension: ".md" | ".mdx" | null;
};

export function isSystemPurpose(contentType: string) {
  return ["knowledge_base", "subject", "system_placeholder"].includes(
    contentType,
  );
}

export function isSupportedNodePurpose(value: unknown): value is NodePurpose {
  return (
    typeof value === "string" &&
    nodePurposeOptions.some((option) => option.value === value)
  );
}

export function isSupportedContentTemplate(
  value: unknown,
): value is ContentTemplate {
  return (
    typeof value === "string" &&
    contentTemplateOptions.some((option) => option.value === value)
  );
}

function duplicatePurposeSibling(
  data: GraphData,
  parentId: string | null,
  purpose: NodePurpose,
  exceptNodeId?: string,
) {
  if (!["module_summary", "unassigned_fragments"].includes(purpose)) {
    return null;
  }
  return data.nodes.find(
    (node) =>
      node.node_id !== exceptNodeId &&
      node.primary_parent_id === parentId &&
      node.content_type === purpose &&
      node.status === "active",
  );
}

export function validatePurposeChange(
  data: GraphData,
  node: GraphNode,
  purposeValue: unknown,
) {
  if (!isSupportedNodePurpose(purposeValue)) {
    throw new Error("请选择系统支持的节点用途。");
  }
  if (isSystemPurpose(node.content_type)) {
    throw new Error("知识库根、学科根和系统占位节点的用途由系统维护。");
  }
  if (node.metadata?.immutable_archive) {
    throw new Error("不可变原始归档的用途受保护，不能通过网页修改。");
  }
  const duplicate = duplicatePurposeSibling(
    data,
    node.primary_parent_id,
    purposeValue,
    node.node_id,
  );
  if (duplicate) {
    throw new Error(
      purposeValue === "module_summary"
        ? "同一父节点下已经有有效的模块总结节点。"
        : "同一父节点下已经有有效的未归属内容节点。",
    );
  }
  return purposeValue;
}

export function resolveCreateSpec(
  data: GraphData,
  parent: GraphNode,
  purposeValue: unknown,
  createContentValue: unknown,
  templateValue: unknown,
): CreateSpec {
  if (!isSupportedNodePurpose(purposeValue)) {
    throw new Error("请选择系统支持的节点用途。");
  }
  const duplicate = duplicatePurposeSibling(
    data,
    parent.node_id,
    purposeValue,
  );
  if (duplicate) {
    throw new Error(
      purposeValue === "module_summary"
        ? "当前父节点下已经有有效的模块总结节点。"
        : "当前父节点下已经有有效的未归属内容节点。",
    );
  }
  const createContent = createContentValue === true;
  const contentTemplate = isSupportedContentTemplate(templateValue)
    ? templateValue
    : "purpose_default";
  return {
    purpose: purposeValue,
    create_content: createContent,
    content_template: contentTemplate,
    // 兼容旧数据读取；能力判断不得依赖node_kind。
    node_kind: createContent ? "content" : "container",
    content_type: purposeValue,
    extension: createContent
      ? purposeValue === "raw_note" && contentTemplate === "purpose_default"
        ? ".md"
        : ".mdx"
      : null,
  };
}

export function resolveContentTemplate(
  node: GraphNode,
  templateValue: unknown,
) {
  const selected = isSupportedContentTemplate(templateValue)
    ? templateValue
    : "purpose_default";
  if (selected === "generic") return "generic";
  return isSupportedNodePurpose(node.content_type)
    ? node.content_type
    : "generic";
}

export function initialContentForCreatedNode(
  node: GraphNode,
  parent: GraphNode | null,
  templateValue: unknown = node.metadata?.content_template,
) {
  const template = resolveContentTemplate(node, templateValue);
  const common = {
    node_id: node.node_id,
    primary_parent_id: node.primary_parent_id,
    subject: "physics",
    visibility: "private",
    status: template === "problem_note" ? "inbox" : "draft",
    content_type: node.content_type,
    manual_override: true,
    last_manual_edit_at: new Date().toISOString(),
  };
  if (template === "problem_note") {
    return matter.stringify(
      `\n# 原始记录\n\nTODO\n\n# 题型摘要\n\nTODO\n\n# 我当时卡在哪里\n\nTODO\n\n# 核心题眼\n\nTODO\n\n# 关联模型\n\nTODO\n\n# 下次看到类似题先想什么\n\nTODO\n`,
      {
        ...common,
        id: node.node_id,
        anchor_type: "unknown_source",
        anchor_text: node.name,
        module: parent?.name ?? "TODO",
        submodule: "TODO",
        source: "manual-node",
        analysis_state: "empty",
        needs_ai_analysis: true,
        has_original_analysis: false,
        difficulty: "TODO",
        review_priority: "TODO",
        error_type: ["TODO"],
        knowledge_points: ["TODO"],
        worth_public_rewrite: false,
        boundary_confidence: "high",
        classification_confidence: "low",
      },
    );
  }
  if (template === "module_summary") {
    return matter.stringify(
      `\n# ${node.name}\n\n## 1. 原始整理\n\nTODO\n\n## 2. 核心模型\n\nTODO\n\n## 3. 关键公式\n\nTODO\n\n## 4. 题眼判断\n\nTODO\n\n## 5. 常见错因\n\nTODO\n\n## 6. 关联错题\n\nTODO\n\n## 7. 待补充\n\nTODO\n`,
      { ...common, module: parent?.name ?? "TODO" },
    );
  }
  if (template === "unassigned_fragments") {
    return matter.stringify(`\n# ${node.name}\n\nTODO\n`, {
      ...common,
      module: parent?.name ?? "未分类",
    });
  }
  return matter.stringify(`\n# ${node.name}\n\nTODO\n`, common);
}
