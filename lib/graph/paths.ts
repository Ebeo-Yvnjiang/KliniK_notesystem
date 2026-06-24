import path from "node:path";

export const projectRoot = /* turbopackIgnore: true */ process.cwd();
export const graphRoot = path.join(projectRoot, "data", "graph");
export const nodesPath = path.join(graphRoot, "nodes.json");
export const edgesPath = path.join(graphRoot, "edges.json");
export const policiesPath = path.join(graphRoot, "permission-policies.json");
export const idStatePath = path.join(graphRoot, "id-state.json");
export const idLockPath = path.join(graphRoot, ".id-allocation.lock");
export const graphWriteLockPath = path.join(graphRoot, ".graph-write.lock");
export const graphAuditPath = path.join(graphRoot, "audit-events.jsonl");
export const legacyRouteMapPath = path.join(graphRoot, "legacy-route-map.json");
export const rekeyMapPath = path.join(graphRoot, "rekey-map.json");
export const manualOverrideHashesPath = path.join(
  graphRoot,
  "manual-override-body-hashes.json",
);
export const graphBackupsRoot = path.join(projectRoot, "data", "backups", "graph");
export const problemIndexPath = path.join(
  projectRoot,
  "data",
  "indexes",
  "physics-problem-index.json",
);
export const moduleIndexPath = path.join(
  projectRoot,
  "data",
  "indexes",
  "physics-module-index.json",
);
