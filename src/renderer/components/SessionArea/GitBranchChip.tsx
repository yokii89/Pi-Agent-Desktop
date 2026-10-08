import { CaretDown, Check, GitBranch, Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitBranchesResult } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { gitService } from "../../services/gitService";
import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore } from "../../stores/uiStore";
import { Popover } from "../ui/Popover";
import styles from "./GitBranchChip.module.css";

interface GitBranchChipProps {
  /** 仓库工作目录（绝对路径）。 */
  cwd: string;
  /** 弹层相对触发器的方向：空态输入栏向上，会话 header 向下。 */
  direction?: "top" | "bottom";
  /** 触发器观感：default=空态输入栏；meta=会话 header 元信息胶囊。 */
  variant?: "default" | "meta";
}

/**
 * Git 分支芯片 + 检出弹层：空态输入栏与会话 header 共用同一套分支选择交互，
 * 避免两处各写一套后弹层形状、禁用态与「创建并检出」行为走样。
 */
export function GitBranchChip({ cwd, direction = "top", variant = "default" }: GitBranchChipProps) {
  const t = useT();
  const { openReview } = useUiStore();
  const { setReviewView } = useReviewStore();
  const [branchQuery, setBranchQuery] = useState("");
  const [branchData, setBranchData] = useState<GitBranchesResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);

  const refreshBranches = useCallback(() => {
    gitService
      .branches(cwd)
      .then(setBranchData)
      .catch(() => setBranchData(null));
  }, [cwd]);

  useEffect(() => {
    refreshBranches();
  }, [refreshBranches]);

  const filteredBranches = useMemo(() => {
    const list = branchData?.branches ?? [];
    const q = branchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((b) => b.name.toLowerCase().includes(q));
  }, [branchData, branchQuery]);

  const checkout = async (branch: string, create: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await gitService.checkout({ cwd, branch, create });
      setBranchData(next);
      setCreating(false);
      setCreateName("");
      setBranchQuery("");
    } catch {
      // 失败保持面板打开，用户可改名重试
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      direction={direction}
      align="left"
      trigger={({ onClick }) => (
        <button
          type="button"
          className={variant === "meta" ? styles.chipMeta : styles.chip}
          onClick={onClick}
        >
          <GitBranch size={14} weight="regular" />
          <span className={styles.chipLabel}>{branchData?.current ?? t("session.git.branch")}</span>
          <CaretDown size={12} weight="regular" />
        </button>
      )}
    >
      <div className={styles.panel}>
        <div className={styles.searchRow}>
          <input
            className={styles.search}
            placeholder={t("session.git.search")}
            value={branchQuery}
            onChange={(e) => setBranchQuery(e.target.value)}
          />
        </div>
        <p className={styles.sectionLabel}>{t("session.git.branches")}</p>
        <div className={styles.list}>
          {filteredBranches.map((branch) => (
            <button
              key={branch.name}
              type="button"
              className={[styles.row, branch.current ? styles.rowActive : ""].join(" ")}
              disabled={busy || branch.current}
              onClick={() => void checkout(branch.name, false)}
            >
              <GitBranch size={16} weight="regular" />
              <span className={styles.col}>
                <span className={styles.rowLabel}>{branch.name}</span>
                {branch.current && (branchData?.dirtyCount ?? 0) > 0 && (
                  <span className={styles.hint}>
                    {t("session.git.dirty", { count: branchData?.dirtyCount ?? 0 })}
                  </span>
                )}
              </span>
              {branch.current && <Check size={16} weight="regular" className={styles.check} />}
            </button>
          ))}
          {filteredBranches.length === 0 && (
            <p className={styles.empty}>{t("session.git.empty")}</p>
          )}
        </div>
        <div className={styles.divider} />
        {creating ? (
          <div className={styles.createRow}>
            <input
              ref={createInputRef}
              className={styles.search}
              placeholder={t("session.git.newBranchName")}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && createName.trim()) {
                  void checkout(createName.trim(), true);
                }
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <button
              type="button"
              className={styles.createBtn}
              disabled={busy || !createName.trim()}
              onClick={() => void checkout(createName.trim(), true)}
            >
              {t("session.git.create")}
            </button>
          </div>
        ) : (
          <button type="button" className={styles.row} onClick={() => setCreating(true)}>
            <Plus size={16} weight="regular" />
            <span>{t("session.git.createCheckout")}</span>
          </button>
        )}
        <button
          type="button"
          className={styles.row}
          onClick={() => {
            setReviewView("graph");
            openReview();
          }}
        >
          <GitBranch size={16} weight="regular" />
          <span>{t("session.git.graph")}</span>
        </button>
      </div>
    </Popover>
  );
}
