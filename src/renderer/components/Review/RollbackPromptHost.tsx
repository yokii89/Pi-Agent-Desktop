import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore } from "../../stores/uiStore";
import { buildRollbackFailToast, buildRollbackSuccessToast } from "../../utils/rollbackLastRound";
import { RollbackLastRoundDialog } from "../ui/RollbackLastRoundDialog";

/**
 * 回滚确认弹窗的全局宿主：确认状态在 reviewStore（快捷键与两处按钮触发同一确认流），
 * 弹窗只在此渲染一次，避免多宿主同时弹出。
 */
export function RollbackPromptHost() {
  const { showToast } = useUiStore();
  const {
    rollbackPromptOpen,
    rollbackPromptInspect,
    rollingBack,
    dismissRollbackPrompt,
    confirmRollbackPrompt,
  } = useReviewStore();
  if (!rollbackPromptOpen) return null;
  return (
    <RollbackLastRoundDialog
      open
      busy={rollingBack}
      inspect={rollbackPromptInspect}
      onCancel={dismissRollbackPrompt}
      onConfirm={() => {
        void confirmRollbackPrompt()
          .then((result) => {
            if (result) showToast(buildRollbackSuccessToast(result));
          })
          .catch((err: unknown) => {
            showToast(buildRollbackFailToast(err));
          });
      }}
    />
  );
}
