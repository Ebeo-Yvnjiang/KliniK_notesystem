import { ReviewQueuePage } from "@/components/review-queue-page";
import { getProblems } from "@/lib/content";

export const metadata = { title: "低分类信度" };

export default function LowClassificationPage() {
  const problems = getProblems().filter(
    (problem) => problem.classification_confidence === "low",
  );
  return (
    <ReviewQueuePage
      description="检查模块、知识点和错因分类"
      eyebrow="CLASSIFICATION REVIEW"
      problems={problems}
      title="低分类信度：需要检查模块/知识点/错因分类"
    />
  );
}
