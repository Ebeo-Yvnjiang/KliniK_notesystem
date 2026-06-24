import { notFound, redirect } from "next/navigation";
import { getModuleBySlug } from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function LegacyModuleSummaryPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: slug } = await params;
  const module = getModuleBySlug(slug);
  if (!module || !module.summary_node_id) notFound();
  redirect(`/nodes/${module.summary_node_id}`);
}
