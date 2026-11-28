import { useEffect } from "react";
import { useSessionMeta } from "../stores/sessionStore";
import type { AssistantBlock } from "../stores/sessionTranscript";
import { useSessionToolReveal } from "../stores/sessionToolReveal";

/** Expand only after an explicit source-navigation request for this session and tool. */
export function useRevealSessionTools(
  blocks: readonly AssistantBlock[],
  setOpen: (open: boolean) => void,
): void {
  const request = useSessionToolReveal();
  const { activeSessionId } = useSessionMeta();
  useEffect(() => {
    if (
      request?.sessionId === activeSessionId &&
      blocks.some((block) => block.kind === "tool" && block.toolCallId === request.toolCallId)
    ) {
      setOpen(true);
    }
  }, [request, activeSessionId, blocks, setOpen]);
}
