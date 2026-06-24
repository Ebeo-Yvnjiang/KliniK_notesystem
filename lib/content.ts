import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { ModuleStat, ProblemIndexItem } from "./types";
import {
  getGraphNode,
  getGraphNodes,
  resolveContentPath,
} from "./graph/store";

const problemIndexPath = path.join(
  process.cwd(),
  "data",
  "indexes",
  "physics-problem-index.json",
);
const moduleIndexPath = path.join(
  process.cwd(),
  "data",
  "indexes",
  "physics-module-index.json",
);
const moduleContentRoot = path.join(
  process.cwd(),
  "content",
  "private",
  "subjects",
  "physics",
  "modules",
);
const problemContentRoot = path.join(
  process.cwd(),
  "content",
  "private",
  "subjects",
  "physics",
  "problem-notes",
);
const rawNotePath = path.join(
  process.cwd(),
  "content",
  "private",
  "raw-notes",
  "demo-original.md",
);

export function getProblems(): ProblemIndexItem[] {
  return JSON.parse(fs.readFileSync(problemIndexPath, "utf8"));
}

export function getModuleStats(): ModuleStat[] {
  return JSON.parse(fs.readFileSync(moduleIndexPath, "utf8"));
}

export function moduleSlug(name: string) {
  return (
    getModuleStats().find(
      (item) => item.name === name || item.node_id === name,
    )?.slug ?? encodeURIComponent(name)
  );
}

export function getModuleBySlug(slug: string) {
  return getModuleStats().find((item) => item.slug === slug);
}

export function getModuleDocument(moduleIdentity: string) {
  const item = getModuleStats().find(
    (module) =>
      module.node_id === moduleIdentity || module.name === moduleIdentity,
  );
  if (!item) throw new Error(`Unknown module: ${moduleIdentity}`);
  const summaryNode = getGraphNode(item.summary_node_id);
  if (!summaryNode) throw new Error(`Missing summary node: ${item.summary_node_id}`);
  const filePath = resolveContentPath(summaryNode);
  if (!filePath) throw new Error(`Summary node has no content: ${item.summary_node_id}`);
  const source = fs.readFileSync(filePath, "utf8");
  return matter(source);
}

export function getModuleSource(moduleIdentity: string) {
  const item = getModuleStats().find(
    (module) =>
      module.node_id === moduleIdentity || module.name === moduleIdentity,
  );
  if (!item) throw new Error(`Unknown module: ${moduleIdentity}`);
  const summaryNode = getGraphNode(item.summary_node_id);
  if (!summaryNode) throw new Error(`Missing summary node: ${item.summary_node_id}`);
  const filePath = resolveContentPath(summaryNode);
  if (!filePath) throw new Error(`Summary node has no content: ${item.summary_node_id}`);
  return fs.readFileSync(filePath, "utf8");
}

export function getProblemDocument(id: string) {
  const item = getProblems().find(
    (problem) => problem.id === id || problem.node_id === id,
  );
  if (!item) return null;
  const node = getGraphNode(item.node_id);
  if (!node) return null;
  const filePath = resolveContentPath(node);
  if (!filePath) return null;
  const source = fs.readFileSync(filePath, "utf8");
  const document = matter(source);
  return {
    ...document,
    hasTodo: source.includes("TODO"),
  };
}

export function getProblemSource(id: string) {
  const item = getProblems().find(
    (problem) => problem.id === id || problem.node_id === id,
  );
  if (!item) return null;
  const node = getGraphNode(item.node_id);
  if (!node) return null;
  const filePath = resolveContentPath(node);
  return filePath ? fs.readFileSync(filePath, "utf8") : null;
}

export function getRawNote() {
  const node = getGraphNodes().find((item) => item.content_type === "raw_note");
  const filePath = node ? resolveContentPath(node) : rawNotePath;
  return fs.readFileSync(filePath ?? rawNotePath, "utf8");
}
