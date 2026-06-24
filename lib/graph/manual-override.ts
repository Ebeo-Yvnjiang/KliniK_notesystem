import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { manualOverrideHashesPath, projectRoot } from "./paths.ts";
import { readGraphData } from "./store.ts";

export function markdownBodyHash(source: string) {
  return crypto
    .createHash("sha256")
    .update(matter(source).content.replace(/\r\n/g, "\n"), "utf8")
    .digest("hex");
}

async function writeAtomic(filePath: string, content: string) {
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, content, "utf8");
  try {
    await fs.rename(temp, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(temp, filePath);
  }
}

export async function buildManualOverrideHashManifest() {
  const entries: Record<string, string> = {};
  for (const node of readGraphData().nodes) {
    if (!node.content_path) continue;
    const source = await fs.readFile(path.resolve(projectRoot, node.content_path), "utf8");
    if (/^manual_override:\s*true\s*$/m.test(source)) {
      entries[node.content_path.replaceAll("\\", "/")] = markdownBodyHash(source);
    }
  }
  await writeAtomic(
    manualOverrideHashesPath,
    `${JSON.stringify(
      { updated_at: new Date().toISOString(), entries },
      null,
      2,
    )}\n`,
  );
  return entries;
}

export async function recordManualOverrideHash(
  relativePath: string,
  source: string,
) {
  const manifest = JSON.parse(
    await fs.readFile(manualOverrideHashesPath, "utf8").catch(() => '{"entries":{}}'),
  ) as { updated_at?: string; entries: Record<string, string> };
  manifest.updated_at = new Date().toISOString();
  manifest.entries[relativePath.replaceAll("\\", "/")] = markdownBodyHash(source);
  await writeAtomic(
    manualOverrideHashesPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
