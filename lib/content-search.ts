import fs from "node:fs";
import matter from "gray-matter";
import {
  getGraphNodes,
  getNodeAncestors,
  resolveContentPath,
} from "./graph/store.ts";
import { searchableContentNodes } from "./graph/content-access.ts";

export type ContentSearchResult = {
  node_id: string;
  name: string;
  content_type: string;
  path: string;
  excerpt: string;
  match_start: number;
  match_length: number;
};

function searchableText(source: string) {
  return matter(source).content
    .replace(/!\[([^\]]*)]\([^)]+\)/g, " $1 ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function excerptFor(text: string, matchIndex: number, matchLength: number) {
  const radius = 90;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + matchLength + radius);
  const excerpt = `${start > 0 ? "…" : ""}${text.slice(start, end)}${
    end < text.length ? "…" : ""
  }`;
  return {
    excerpt,
    match_start: matchIndex - start + (start > 0 ? 1 : 0),
    match_length: matchLength,
  };
}

export function searchGraphContent(
  query: string,
  options?: { includeArchived?: boolean; limit?: number },
) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) return [] as ContentSearchResult[];
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const nodes = getGraphNodes();
  const results: ContentSearchResult[] = [];
  for (const node of searchableContentNodes(
    nodes,
    options?.includeArchived ?? false,
  )) {
    const filePath = resolveContentPath(node);
    if (!filePath) continue;
    const content = searchableText(fs.readFileSync(filePath, "utf8"));
    const haystack = `${node.name}\n${content}`;
    const normalized = haystack.toLocaleLowerCase("zh-CN");
    if (!tokens.every((token) => normalized.includes(token))) continue;
    const matchIndex = normalized.indexOf(normalizedQuery);
    const tokenMatches = tokens
      .map((token) => ({ token, index: normalized.indexOf(token) }))
      .sort((left, right) => left.index - right.index);
    const firstMatch = tokenMatches[0];
    const firstIndex = matchIndex >= 0 ? matchIndex : firstMatch.index;
    const matchLength =
      matchIndex >= 0 ? normalizedQuery.length : firstMatch.token.length;
    const snippet = excerptFor(haystack, firstIndex, matchLength);
    const ancestors = getNodeAncestors(node.node_id);
    results.push({
      node_id: node.node_id,
      name: node.name,
      content_type: node.content_type,
      path: [...ancestors, node].map((item) => item.name).join(" / "),
      ...snippet,
    });
    if (results.length >= (options?.limit ?? 100)) break;
  }
  return results;
}
