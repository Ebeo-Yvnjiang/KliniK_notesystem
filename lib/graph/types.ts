export type NodeKind = "container" | "content";
export type NodeStatus = "active" | "archived";

export interface GraphNode {
  node_id: string;
  node_kind: NodeKind;
  content_type: string;
  name: string;
  primary_parent_id: string | null;
  status: NodeStatus;
  sort_order: number;
  content_path: string | null;
  aliases: string[];
  external_ids: string[];
  permission_policy_id: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export type RelationType =
  | "cites"
  | "related_to"
  | "supports"
  | "derived_from"
  | "shortcut_to"
  | "supersedes";

export interface GraphEdge {
  edge_id: string;
  from_node_id: string;
  to_node_id: string;
  relation_type: RelationType;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type PermissionAction =
  | "view"
  | "edit"
  | "move"
  | "create_child"
  | "create_edge"
  | "archive"
  | "delete"
  | "rekey"
  | "manage_permissions";

export interface PermissionPolicy {
  permission_policy_id: string;
  name: string;
  description: string;
  inherit_from_parent: boolean;
  grants: Record<string, PermissionAction[]>;
}

export interface GraphIdState {
  next_node_id: number;
  next_edge_id: number;
  retired_node_ids: string[];
  retired_edge_ids: string[];
  updated_at: string;
}

export type GraphAuditEventType =
  | "node_created"
  | "node_content_created"
  | "node_purpose_changed"
  | "node_renamed"
  | "node_moved"
  | "nodes_bulk_moved"
  | "node_reordered"
  | "node_merged"
  | "node_archived"
  | "node_restored"
  | "node_deleted"
  | "node_rekeyed"
  | "edge_created"
  | "edge_deleted"
  | "permission_changed"
  | "backup_restored"
  | "problem_primary_parent_changed";

export interface GraphAuditEvent {
  event_id: string;
  event_type: GraphAuditEventType;
  timestamp: string;
  source: "admin_ui" | "manual_editor" | "migration" | "generator" | "test";
  success: boolean;
  actor: "local_admin";
  node_ids: string[];
  edge_ids: string[];
  before: unknown;
  after: unknown;
  impact: Record<string, unknown>;
  backup_path: string | null;
  reason: string;
  failure_reason: string | null;
  classification_evidence: boolean;
  test_event?: boolean;
  active?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  permissionPolicies: PermissionPolicy[];
}

export interface GraphIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  node_id?: string;
  edge_id?: string;
  file_path?: string;
}
