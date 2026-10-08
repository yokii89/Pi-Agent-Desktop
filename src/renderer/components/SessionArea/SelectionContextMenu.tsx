import { Copy, Quotes } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import { ContextMenu } from "../ui/ContextMenu";
import type { MenuItem } from "../ui/Menu";

interface SelectionContextMenuProps {
  /** 视口坐标（contextmenu 的 clientX/Y），ContextMenu 负责收拢进视口。 */
  position: { x: number; y: number };
  /** 选中的纯文本。 */
  text: string;
  /** 输入栏锁定（running / 切换中 / 阻断浮层）时引用不可用。 */
  quoteDisabled: boolean;
  /** 引用置灰原因（条目尾注）。 */
  quoteDisabledHint: string;
  onCopy: (text: string) => void;
  onQuote: (text: string) => void;
  onClose: () => void;
}

/** 会话流划选后的右键浮窗（docs/design/12）：复制 / 添加到对话栏。 */
export function SelectionContextMenu({
  position,
  text,
  quoteDisabled,
  quoteDisabledHint,
  onCopy,
  onQuote,
  onClose,
}: SelectionContextMenuProps) {
  const t = useT();
  const items: MenuItem[] = [
    {
      key: "copy",
      label: t("session.selectMenu.copy"),
      icon: <Copy size={16} weight="regular" />,
      hint: "Ctrl+C",
      onSelect: () => onCopy(text),
    },
    {
      key: "quote",
      label: t("session.selectMenu.quote"),
      icon: <Quotes size={16} weight="regular" />,
      disabled: quoteDisabled,
      hint: quoteDisabled ? quoteDisabledHint : undefined,
      onSelect: () => onQuote(text),
    },
  ];
  return <ContextMenu position={position} items={items} onClose={onClose} />;
}
