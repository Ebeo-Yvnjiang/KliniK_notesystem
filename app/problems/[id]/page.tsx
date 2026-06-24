import { notFound, redirect } from "next/navigation";
import { getProblems } from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function LegacyProblemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const problem = getProblems().find((item) => item.id === id);
  if (!problem) notFound();
  redirect(`/nodes/${problem.node_id}`);
}
