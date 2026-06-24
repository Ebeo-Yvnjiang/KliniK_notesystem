import { ReviewQueuePage } from "@/components/review-queue-page";
import { getProblems } from "@/lib/content";

export const metadata = { title: "低边界信度" };

export default function LowBoundaryPage() {
  const problems = getProblems().filter(
    (problem) => problem.boundary_confidence === "low",
  );
  return (
    <ReviewQueuePage
      description="检查原始段落是否归入了正确的题目卡"
      eyebrow="BOUNDARY REVIEW"
      problems={problems}
      title="低边界信度：需要检查拆分是否正确"
    />
  );
}
