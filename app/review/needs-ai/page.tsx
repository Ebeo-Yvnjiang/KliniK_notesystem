import { ReviewQueuePage } from "@/components/review-queue-page";
import { getProblems } from "@/lib/content";

export const metadata = { title: "待 AI 补解析" };

export default function NeedsAiPage() {
  const problems = getProblems().filter((problem) => problem.needs_ai_analysis);
  return (
    <ReviewQueuePage
      description="原始记录为空或只有部分分析，后续可单独补充"
      eyebrow="ANALYSIS QUEUE"
      problems={problems}
      title="待 AI 补解析"
    />
  );
}
