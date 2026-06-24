import { ClassificationTrialPanel } from "@/components/classification-trial-panel";
import {
  buildUnclassifiedClassificationTaskPackage,
  readPendingSuggestionStore,
} from "@/lib/classification-trial";
import { getGraphVersion } from "@/lib/graph/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "阶段B分类试运行" };

export default async function ClassificationTrialPage() {
  const taskPackage = buildUnclassifiedClassificationTaskPackage({ limit: 10 });
  const pending = readPendingSuggestionStore();
  return (
    <>
      <section className="page-heading backend-heading">
        <p className="eyebrow">STAGE B / CLASSIFICATION TRIAL</p>
        <h1>阶段B分类试运行</h1>
        <p>
          导出未分类题目任务包，导入外部 AI/Codex 的 JSON 建议，然后由用户逐条确认。
          本页不会直接调用外部 AI，也不会在确认前移动节点。
        </p>
      </section>
      <ClassificationTrialPanel
        graphVersion={getGraphVersion()}
        initialPending={pending}
        initialTaskPackage={taskPackage}
      />
    </>
  );
}
