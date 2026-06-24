import { notFound, redirect } from "next/navigation";
import { getGraphNodes } from "@/lib/graph/store";

export const dynamic = "force-dynamic";

export default function LegacyRawPage() {
  const raw = getGraphNodes().find((node) => node.content_type === "raw_note");
  if (!raw) notFound();
  redirect(`/nodes/${raw.node_id}`);
}
