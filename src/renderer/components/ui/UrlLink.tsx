import { Globe } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useFavicon } from "../../hooks/useFavicon";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import iconStyles from "../../styles/linkIcon.module.css";

interface UrlLinkProps {
  /** 外链目标，只在 http(s) 时使用；本地路径与其余协议的分流归调用方（MarkdownDoc）。 */
  url: string;
  /** 站点皮肤：字色 / 下划线 / 字号由调用方的 CSS 决定，本组件一概不写。 */
  className?: string;
  /** 链接文本，缺省渲染 url 本身（用户气泡里就是一串 URL）。 */
  children?: ReactNode;
  /** 徽标型链接（图本身已是标识）不挂站点图标槽；关闭时连抓取也不发起。 */
  withIcon?: boolean;
}

/**
 * 一条 http(s) 外链的唯一渲染来源：「站点图标 + 链接文本」，点击交系统浏览器，
 * 禁止应用内导航（docs/design/13 P0-1；图标形态见 docs/design/130，三处同源见 131）。
 * 图标由主进程代抓 favicon（按 origin 缓存，渲染层不挂任何外链），未命中用 Globe 占位、
 * 同档尺寸不抖动。输入栏草稿在 contenteditable 里只能 imperative 建节点
 * （composerLinks.ts 的孪生路数），但吃同一份 faviconService、同一张图标配方 CSS。
 */
export function UrlLink({ url, className, children, withIcon = true }: UrlLinkProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const favicon = useFavicon(withIcon ? url : null);

  return (
    <a
      href={url}
      title={url}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        // IPC 统一信封：失败以 ok:false 返回而非 reject，两路都要报
        void window.pidesk?.window
          .openExternal(url)
          .then((result) => {
            if (!result.ok) showToast(result.error ?? t("common.openFailed"));
          })
          .catch(() => showToast(t("common.openFailed")));
      }}
    >
      {withIcon && (
        <span className={iconStyles.linkIcon} aria-hidden="true">
          {favicon ? (
            <img src={favicon} alt="" draggable={false} />
          ) : (
            <Globe size={14} weight="regular" />
          )}
        </span>
      )}
      {children ?? url}
    </a>
  );
}
