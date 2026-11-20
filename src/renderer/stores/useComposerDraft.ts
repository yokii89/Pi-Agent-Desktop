import { useCallback, useMemo, useSyncExternalStore } from "react";
import { type ComposerFileAttachment, MAX_ATTACH_FILES } from "../utils/fileAttach";
import { type ComposerImageAttachment, MAX_ATTACH_IMAGES } from "../utils/imageAttach";
import { moveById } from "../utils/listReorder";
import { type ComposerDraftPart, sameComposerContent } from "./composerDrafts";
import { type FileMention, useComposerStore } from "./composerStore";

/** 同一个首页 key 被下一任务复用时，订阅草稿对象的变化。 */
export function useComposerDraftHandle(key: string) {
  const { drafts } = useComposerStore();
  const getRecord = useCallback(() => drafts.bind(key), [drafts, key]);
  return useSyncExternalStore(drafts.subscribe, getRecord);
}

/** 所有修改绑定草稿对象，异步发送/图片解码完成时不会写入用户刚切换的会话。 */
export function useComposerDraft(key: string) {
  const { drafts } = useComposerStore();
  const record = useComposerDraftHandle(key);
  const actions = useMemo(
    () => ({
      getSnapshot: record.getSnapshot,
      setContent(content: ComposerDraftPart[]): void {
        record.update((draft) =>
          sameComposerContent(draft.content, content) ? draft : { ...draft, content },
        );
      },
      addFileMention(item: FileMention): void {
        record.update((draft) =>
          draft.fileMentions.some((mention) => mention.path === item.path)
            ? draft
            : { ...draft, fileMentions: [...draft.fileMentions, item] },
        );
      },
      removeFileMention(path: string): void {
        record.update((draft) => {
          if (!draft.fileMentions.some((mention) => mention.path === path)) return draft;
          return {
            ...draft,
            content: draft.content.filter((part) => part.kind !== "file" || part.path !== path),
            fileMentions: draft.fileMentions.filter((mention) => mention.path !== path),
          };
        });
      },
      addImageAttachment(item: ComposerImageAttachment): boolean {
        const draft = record.getSnapshot();
        if (draft.imageAttachments.length >= MAX_ATTACH_IMAGES) return false;
        record.update(() => ({ ...draft, imageAttachments: [...draft.imageAttachments, item] }));
        return true;
      },
      removeImageAttachment(id: string): void {
        record.update((draft) =>
          draft.imageAttachments.some((item) => item.id === id)
            ? {
                ...draft,
                imageAttachments: draft.imageAttachments.filter((item) => item.id !== id),
              }
            : draft,
        );
      },
      reorderImageAttachments(fromId: string, toId: string): void {
        record.update((draft) => {
          const imageAttachments = moveById(draft.imageAttachments, fromId, toId);
          return imageAttachments === draft.imageAttachments
            ? draft
            : { ...draft, imageAttachments };
        });
      },
      addFileAttachment(item: ComposerFileAttachment): boolean {
        const draft = record.getSnapshot();
        if (draft.fileAttachments.length >= MAX_ATTACH_FILES) return false;
        if (draft.fileAttachments.some((file) => file.path === item.path)) return false;
        record.update(() => ({ ...draft, fileAttachments: [...draft.fileAttachments, item] }));
        return true;
      },
      removeFileAttachment(id: string): void {
        record.update((draft) =>
          draft.fileAttachments.some((item) => item.id === id)
            ? { ...draft, fileAttachments: draft.fileAttachments.filter((item) => item.id !== id) }
            : draft,
        );
      },
      reorderFileAttachments(fromId: string, toId: string): void {
        record.update((draft) => {
          const fileAttachments = moveById(draft.fileAttachments, fromId, toId);
          return fileAttachments === draft.fileAttachments ? draft : { ...draft, fileAttachments };
        });
      },
      submit: record.submit,
      takeEdits: record.takeEdits,
    }),
    [record],
  );
  const draft = useSyncExternalStore(drafts.subscribe, record.getSnapshot);
  return { ...draft, ...actions, record };
}
