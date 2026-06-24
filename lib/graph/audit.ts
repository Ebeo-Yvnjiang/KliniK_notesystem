import fs from "node:fs";
import { graphAuditPath } from "./paths.ts";
import type { GraphAuditEvent } from "./types.ts";

export function readGraphAuditEvents() {
  if (!fs.existsSync(graphAuditPath)) {
    return { events: [] as GraphAuditEvent[], errors: [] as string[] };
  }
  const events: GraphAuditEvent[] = [];
  const errors: string[] = [];
  fs.readFileSync(graphAuditPath, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!line.trim()) return;
      try {
        events.push(JSON.parse(line) as GraphAuditEvent);
      } catch (error) {
        errors.push(
          `第${index + 1}行：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
  return { events, errors };
}
