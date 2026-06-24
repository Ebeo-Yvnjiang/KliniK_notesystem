import crypto from "node:crypto";

export function contentVersion(source: string) {
  return crypto.createHash("sha256").update(source, "utf8").digest("hex");
}
