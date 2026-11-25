import { Check, Code, Folder, FolderOpen } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkdirOpenTarget } from "../../../shared/ipc";
import { getNamedIconUrl } from "../../fileIcons/resolve";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { settingsService } from "../../services/settingsService";
import { useUiStore } from "../../stores/uiStore";
import { GlideChevron } from "../ui/GlideChevron";
import { Menu } from "../ui/Menu";
import styles from "./WorkdirChip.module.css";

function basename(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? dir;
}

/** 品牌图标：按名取 fileIcons 资产池（icons-extra/，见 NOTICE.md）；缺失时退 Phosphor 兜底图标。 */
function BrandIcon({
  asset,
  size = 16,
  fallback,
}: {
  asset: string;
  /** 渲染尺寸（正方形画布，内容按 viewBox 等比缩放居中）。 */
  size?: number;
  fallback: React.ReactNode;
}) {
  const theme = useResolvedTheme();
  const url = getNamedIconUrl(asset, theme);
  if (!url) return fallback;
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={styles.brandIcon}
    />
  );
}

interface WorkdirChipProps {
  /** 会话工作目录（绝对路径）。 */
  dir: string;
}

/**
 * 会话 header 的工作区分裂按钮（原只读锚点升级，参照 VS Code 分裂按钮）：
 * 左段 = 图标 + 目录名，点击用当前默认方式打开工作目录；右段 = 箭头，
 * 弹菜单选「资源管理器 / VS Code」，选中即执行并记住为默认（勾选跟随）。
 * 悬浮 title 展示完整路径；「⋯」菜单的打开文件夹 / 复制路径保持不变。
 */
export function WorkdirChip({ dir }: WorkdirChipProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const [target, setTarget] = useState<WorkdirOpenTarget>("explorer");
  const [busy, setBusy] = useState(false);
  const targetRef = useRef<WorkdirOpenTarget | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const settingsReady = useRef<Promise<WorkdirOpenTarget> | null>(null);

  const readDefault = useCallback((): Promise<WorkdirOpenTarget> => {
    settingsReady.current ??= settingsService
      .get()
      .then((settings) => (settings?.workdirOpenTarget === "vscode" ? "vscode" : "explorer"));
    return settingsReady.current;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    void readDefault().then((saved) => {
      if (alive && targetRef.current === null) {
        targetRef.current = saved;
        setTarget(saved);
      }
    });
    return () => {
      alive = false;
      mountedRef.current = false;
    };
  }, [readDefault]);

  const open = async (requested?: WorkdirOpenTarget): Promise<void> => {
    // The ref also blocks clicks arriving before React paints the disabled buttons.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let previous: WorkdirOpenTarget = targetRef.current ?? "explorer";
    let opened = false;
    try {
      const saved = await readDefault();
      previous = targetRef.current ?? saved;
      const next = requested ?? previous;
      targetRef.current = next;
      if (mountedRef.current) setTarget(next);
      await (next === "vscode" ? fsService.openInVsCode(dir) : fsService.openPath(dir));
      opened = true;
      const settings = await settingsService.set({ workdirOpenTarget: next });
      if (!settings) showToast(t("session.workspace.saveDefaultFailed"));
    } catch (error) {
      if (!opened) {
        targetRef.current = previous;
        if (mountedRef.current) setTarget(previous);
      }
      showToast(
        opened
          ? t("session.workspace.saveDefaultFailed")
          : error instanceof Error
            ? error.message
            : t("session.workspace.openFailed"),
      );
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <span className={styles.chip} title={dir} aria-busy={busy}>
      <button
        type="button"
        className={styles.main}
        aria-label={t("session.workspace.openWorkdir")}
        disabled={busy}
        onClick={() => void open()}
      >
        <BrandIcon
          asset={target === "vscode" ? "vscode" : "file-explorer"}
          fallback={
            target === "vscode" ? (
              <Code size={16} weight="regular" />
            ) : (
              <Folder size={16} weight="regular" />
            )
          }
        />
        <span className={styles.chipLabel}>{basename(dir)}</span>
      </button>
      <span className={styles.divider} aria-hidden="true" />
      <Menu
        align="left"
        direction="bottom"
        hideScrollbar
        trigger={({ open: menuOpen, onClick }) => (
          <button
            type="button"
            className={[styles.chevron, menuOpen ? styles.chevronOpen : ""].join(" ")}
            aria-label={t("session.workspace.openWith")}
            aria-haspopup="menu"
            disabled={busy}
            onClick={onClick}
          >
            <GlideChevron size={12} />
          </button>
        )}
        items={[
          {
            key: "explorer",
            disabled: busy,
            label: t("session.workspace.openInExplorer"),
            icon: (
              <BrandIcon
                asset="file-explorer"
                fallback={<FolderOpen size={16} weight="regular" />}
              />
            ),
            selected: target === "explorer",
            badge: target === "explorer" ? <Check size={16} weight="regular" /> : undefined,
            onSelect: () => void open("explorer"),
          },
          {
            key: "vscode",
            disabled: busy,
            label: t("session.workspace.openInVsCode"),
            icon: <BrandIcon asset="vscode" fallback={<Code size={16} weight="regular" />} />,
            selected: target === "vscode",
            badge: target === "vscode" ? <Check size={16} weight="regular" /> : undefined,
            onSelect: () => void open("vscode"),
          },
        ]}
      />
    </span>
  );
}
