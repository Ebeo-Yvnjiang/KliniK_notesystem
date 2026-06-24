import fs from "node:fs/promises";
import path from "node:path";
import { graphRoot, idLockPath, idStatePath } from "./paths.ts";
import type { GraphIdState } from "./types.ts";

function formatId(value: number, width: number) {
  return String(value).padStart(width, "0");
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(timeoutMs = 10_000) {
  await fs.mkdir(graphRoot, { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      return await fs.open(idLockPath, "wx");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (Date.now() - started > timeoutMs) {
        throw new Error("节点 ID 分配器被其他操作占用，请稍后重试。");
      }
      await sleep(50);
    }
  }
}

async function readState(): Promise<GraphIdState> {
  try {
    return JSON.parse(await fs.readFile(idStatePath, "utf8")) as GraphIdState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      next_node_id: 1,
      next_edge_id: 1,
      retired_node_ids: [],
      retired_edge_ids: [],
      updated_at: new Date().toISOString(),
    };
  }
}

async function writeState(state: GraphIdState) {
  const temp = path.join(graphRoot, `.id-state.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temp, idStatePath);
}

export async function allocateGraphIds(
  kind: "node" | "edge",
  count = 1,
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 10_000) {
    throw new Error("ID 分配数量无效。");
  }
  const lock = await acquireLock();
  try {
    const state = await readState();
    const key = kind === "node" ? "next_node_id" : "next_edge_id";
    const width = kind === "node" ? 8 : 10;
    const first = state[key];
    const ids = Array.from({ length: count }, (_, index) =>
      formatId(first + index, width),
    );
    state[key] += count;
    state.updated_at = new Date().toISOString();
    await writeState(state);
    return ids;
  } finally {
    await lock.close();
    await fs.rm(idLockPath, { force: true });
  }
}

export async function retireGraphId(
  kind: "node" | "edge",
  id: string,
) {
  const lock = await acquireLock();
  try {
    const state = await readState();
    const list =
      kind === "node" ? state.retired_node_ids : state.retired_edge_ids;
    if (!list.includes(id)) list.push(id);
    state.updated_at = new Date().toISOString();
    await writeState(state);
  } finally {
    await lock.close();
    await fs.rm(idLockPath, { force: true });
  }
}

export async function reserveSpecificNodeId(id: string) {
  if (!isNodeId(id)) throw new Error("新节点 ID 必须是8位数字。");
  const numeric = Number(id);
  const lock = await acquireLock();
  try {
    const state = await readState();
    if (
      numeric < state.next_node_id ||
      state.retired_node_ids.includes(id)
    ) {
      throw new Error(
        `节点 ID ${id} 已进入分配历史或退休列表，不能重新使用。`,
      );
    }
    state.next_node_id = numeric + 1;
    state.updated_at = new Date().toISOString();
    await writeState(state);
  } finally {
    await lock.close();
    await fs.rm(idLockPath, { force: true });
  }
}

export function isNodeId(value: string) {
  return /^\d{8}$/.test(value);
}

export function isEdgeId(value: string) {
  return /^\d{10}$/.test(value);
}
