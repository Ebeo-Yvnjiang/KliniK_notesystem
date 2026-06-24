import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const demoRoot = path.join(projectRoot, "demo-data");
const force = process.argv.includes("--force");

const targets = [
  "content/private/raw-notes/demo-original.md",
  "content/private/subjects/physics/modules/demo-electromagnetism.mdx",
  "content/private/subjects/physics/modules/demo-mechanics.mdx",
  "content/private/subjects/physics/problem-notes/demo-em-001.mdx",
  "content/private/subjects/physics/problem-notes/demo-uncategorized-001.mdx",
  "data/graph/nodes.json",
  "data/graph/edges.json",
  "data/graph/permission-policies.json",
  "data/graph/id-state.json",
  "data/graph/legacy-route-map.json",
  "data/graph/rekey-map.json",
  "data/graph/manual-override-body-hashes.json",
  "data/graph/audit-events.jsonl",
  "data/indexes/physics-problem-index.json",
  "data/indexes/physics-module-index.json",
  "data/corrections/classification-guidance.md",
  "data/corrections/classification-corrections.jsonl",
  "data/classification-trials/pending-suggestions.json",
  "data/classification-trials/suggestion-evaluations.jsonl",
];

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(relativePath: string) {
  const from = path.join(demoRoot, relativePath);
  const to = path.join(projectRoot, relativePath);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

const existingTargets = [];
for (const relativePath of targets) {
  if (await exists(path.join(projectRoot, relativePath))) {
    existingTargets.push(relativePath);
  }
}

if (existingTargets.length > 0 && !force) {
  console.error("检测到本地数据已经存在，已停止以避免覆盖。");
  console.error("如确认要覆盖为 demo 数据，请运行：pnpm run demo:init -- --force");
  console.error("已存在的关键文件：");
  for (const item of existingTargets.slice(0, 20)) {
    console.error(`- ${item}`);
  }
  if (existingTargets.length > 20) {
    console.error(`- ... 另有 ${existingTargets.length - 20} 个文件`);
  }
  process.exit(1);
}

for (const relativePath of targets) {
  await copyFile(relativePath);
}

await fs.mkdir(path.join(projectRoot, "data", "reports"), { recursive: true });
await fs.mkdir(path.join(projectRoot, "data", "backups", "graph"), {
  recursive: true,
});

console.log("Demo 数据已初始化。");
console.log("下一步可以运行：pnpm run graph:check && pnpm dev");
