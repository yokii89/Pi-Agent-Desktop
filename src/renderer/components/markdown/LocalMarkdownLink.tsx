import type { ReactNode } from "react";
import { isHtmlPath } from "../../../shared/fileKinds";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { useBrowserStore } from "../../stores/browserStore";
import { useUiStore } from "../../stores/uiStore";
import { stripLineCol } from "../../utils/fileOpen";

/** 本地 Markdown 链接复用文件面板的离开保护；目录由系统资源管理器打开。 */
export function LocalMarkdownLink({ path, children }: { path: string; children?: ReactNode }) {
  const t = useT();
  const { dispatch, showToast } = useUiStore();
  const browser = useBrowserStore();
  const open = async (system: boolean): Promise<void> => {
    const target = stripLineCol(path);
    if (system) {
      await fsService.openPath(target);
      return;
    }
    // 不能用扩展名猜目录：目录可带点，文件也可以没有扩展名。
    const directory = await fsService.list(target).then(
      () => true,
      () => false,
    );
    if (directory) {
      await fsService.openPath(target);
    } else if (isHtmlPath(target)) {
      await browser.openLocalFile(target);
    } else {
      dispatch({ type: "openFileInPanel", path });
    }
  };
  return (
    <a
      href={path}
      title={t("session.fileLink.title", { path })}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void open(event.ctrlKey || event.metaKey).catch((error: unknown) => {
          showToast(error instanceof Error ? error.message : t("session.fileLink.openFailed"));
        });
      }}
    >
      {children}
    </a>
  );
}
