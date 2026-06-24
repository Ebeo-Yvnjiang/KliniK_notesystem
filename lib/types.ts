export interface ProblemIndexItem {
  node_id: string;
  primary_parent_id: string;
  id: string;
  anchor_type:
    | "external_id"
    | "bracket_source"
    | "exam_source"
    | "image_problem"
    | "unknown_source";
  anchor_text: string;
  module: string;
  submodule: string;
  knowledge_points: string[];
  error_type: string[];
  raw_excerpt: string;
  status: string;
  analysis_state: "empty" | "partial" | "original_note_available";
  needs_ai_analysis: boolean;
  has_original_analysis: boolean;
  review_priority: string;
  boundary_confidence?: "high" | "medium" | "low";
  classification_confidence?: "high" | "medium" | "low";
  classification_status?: string;
  content_type?: string;
  file_path: string;
  has_todo: boolean;
  worth_public_rewrite: boolean;
}

export interface ModuleStat {
  node_id: string;
  summary_node_id: string;
  name: string;
  slug: string;
  order: number;
  problemCount: number;
  recursiveProblemCount?: number;
  todoCount: number;
  filePath: string;
  status: string;
  system_placeholder: boolean;
}
