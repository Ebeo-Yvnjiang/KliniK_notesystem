import { buildClassificationGuidance } from "../lib/classification-corrections.ts";

const result = await buildClassificationGuidance();
console.log(
  `classification guidance built: active=${result.active}, invalid=${result.invalid}, stale=${result.stale}, errors=${result.errors}`,
);
