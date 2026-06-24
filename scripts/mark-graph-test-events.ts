import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const auditPath = path.join(root, "data", "graph", "audit-events.jsonl");
const original = await fs.readFile(auditPath, "utf8");
const backup = path.join(
  root,
  "data",
  "backups",
  `audit-mark-test-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
);
await fs.writeFile(backup, original, "utf8");
let marked = 0;
const lines = original
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const event = JSON.parse(line) as Record<string, unknown>;
    const text = JSON.stringify({
      before: event.before,
      after: event.after,
      reason: event.reason,
    });
    if (
      event.source === "test" ||
      text.includes("__验收") ||
      text.includes("__测试") ||
      text.includes("__删除空节点__") ||
      text.includes("__权限测试__")
    ) {
      event.test_event = true;
      event.active = false;
      marked += 1;
    }
    return JSON.stringify(event);
  });
await fs.writeFile(auditPath, `${lines.join("\n")}\n`, "utf8");
console.log(`marked test audit events: ${marked}; backup=${path.relative(root, backup)}`);
