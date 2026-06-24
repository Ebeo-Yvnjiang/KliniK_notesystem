import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const contentRoot = path.join(root, "content", "private");
const routeMap = JSON.parse(
  await fs.readFile(path.join(root, "data", "graph", "legacy-route-map.json"), "utf8"),
) as { problems: Record<string, string> };
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.join(root, "data", "backups", "content-links", stamp);
const reportPath = path.join(root, "data", "reports", "legacy-link-migration.json");

async function filesUnder(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(item)));
    else if ([".md", ".mdx"].includes(path.extname(entry.name))) result.push(item);
  }
  return result;
}

const files = await filesUnder(contentRoot);
const oldPattern = /\/problems\/([A-Za-z0-9_-]+)/g;
const unmatched: { file: string; target: string }[] = [];
let before = 0;
let migrated = 0;
let changedFiles = 0;

for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  const matches = [...source.matchAll(oldPattern)];
  before += matches.length;
  if (!matches.length) continue;
  const updated = source.replace(oldPattern, (full, legacyId: string) => {
    const nodeId = routeMap.problems[legacyId];
    if (!nodeId) {
      unmatched.push({
        file: path.relative(root, file).replaceAll("\\", "/"),
        target: full,
      });
      return full;
    }
    migrated += 1;
    return `/nodes/${nodeId}`;
  });
  if (updated === source) continue;
  const relative = path.relative(root, file);
  const backup = path.join(backupRoot, relative);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.copyFile(file, backup);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, updated, "utf8");
  await fs.rename(temp, file);
  changedFiles += 1;
}

let after = 0;
for (const file of files) {
  after += [...(await fs.readFile(file, "utf8")).matchAll(oldPattern)].length;
}
const report = {
  generated_at: new Date().toISOString(),
  before,
  migrated,
  after,
  changed_files: changedFiles,
  unmatched,
  backup_path: path.relative(root, backupRoot).replaceAll("\\", "/"),
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
