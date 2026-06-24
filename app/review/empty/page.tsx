import { ReviewQueuePage } from "@/components/review-queue-page";
import { getProblems } from "@/lib/content";

export const metadata = { title: "空卡" };

export default function EmptyCardsPage() {
  const problems = getProblems().filter(
    (problem) => problem.analysis_state === "empty",
  );
  return (
    <ReviewQueuePage
      description="只有题目锚点或待解析提示，没有可用的原始解析"
      eyebrow="EMPTY CARDS"
      problems={problems}
      title="空卡：只有题目锚点，尚无解析"
    />
  );
}
