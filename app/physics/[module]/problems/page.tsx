import { notFound, redirect } from "next/navigation";
import { getModuleBySlug } from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function LegacyModuleProblemsPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: slug } = await params;
  const module = getModuleBySlug(slug);
  if (!module) notFound();
  redirect(`/nodes/${module.node_id}`);
}
