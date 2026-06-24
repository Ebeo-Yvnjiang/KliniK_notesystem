import { buildManualOverrideHashManifest } from "../lib/graph/manual-override.ts";

const entries = await buildManualOverrideHashManifest();
console.log(`manual override body hashes recorded: ${Object.keys(entries).length}`);
