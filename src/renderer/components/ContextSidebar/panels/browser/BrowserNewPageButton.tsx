import { Plus } from "@phosphor-icons/react";
import { useT } from "../../../../hooks/useT";
import { MAX_BROWSER_INSTANCES, useBrowserStore } from "../../../../stores/browserStore";
import { IconButton } from "../../../ui/IconButton";

/**
 * 新建页面加号：点击直接创建一个浏览器页并切过去（当前仅此一种页面类型）。
 * 达到实例上限时禁用并提示。
 */
export function BrowserNewPageButton() {
  const t = useT();
  const store = useBrowserStore();
  const atLimit = store.pages.length >= MAX_BROWSER_INSTANCES;

  return (
    <IconButton
      title={
        atLimit ? t("browser.page.atLimit", { count: MAX_BROWSER_INSTANCES }) : t("browser.newPage")
      }
      disabled={atLimit}
      aria-label={t("browser.newPage")}
      onClick={() => {
        if (!atLimit) void store.createPage();
      }}
    >
      <Plus size={16} weight="regular" />
    </IconButton>
  );
}
