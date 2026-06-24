import { ReviewQueuePage } from "@/components/review-queue-page";
import { getProblems } from "@/lib/content";

export const metadata = { title: "未归属题目片段" };

export default function UnassignedPage() {
  const problems = getProblems().filter(
    (problem) => problem.status === "needs_manual_assignment",
  );
  return (
    <ReviewQueuePage
      description="疑似具体题目解析，但暂时无法可靠归入某张题目卡"
      eyebrow="MANUAL ASSIGNMENT"
      problems={problems}
      title="未归属题目片段"
    />
  );
}
