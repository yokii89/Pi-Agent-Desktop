import {
  AtIcon,
  Check,
  ClipboardText,
  ListMagnifyingGlass,
  Paperclip,
  PaperPlaneRight,
  Plus,
  Shield,
  ShieldCheck,
  Sparkle,
  Spinner,
} from "@phosphor-icons/react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { AccessModeIconName } from "../../../shared/contribution";
import type { PiModelOption, ThinkingLevelId } from "../../../shared/ipc";
import { ACCESS_MODE_ACTIONS } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { authService } from "../../services/authService";
import { sessionService } from "../../services/sessionService";
import { THINKING_LABEL_KEY, useComposerStore } from "../../stores/composerStore";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { AiModelIcon } from "../AiIcons/AiModelIcon";
import { GlideChevron } from "../ui/GlideChevron";
import { Menu, type MenuItem } from "../ui/Menu";
import { OptionList, type OptionRow } from "../ui/OptionList";
import { Popover } from "../ui/Popover";
import { ThinkingLevelSlider } from "../ui/ThinkingLevelSlider";
import { ContextUsageChip } from "./ContextUsageChip";
import { SendButton } from "./SendButton";
import styles from "./TaskInputToolbar.module.css";

interface ToolbarProps {
  running: boolean;
  canSend: boolean;
  onPlusAction: (action: "mention" | "slash") => void;
  /** 系统选中的附件文件（docs/design/21 + 25）；上层按图片/文件分流。 */
  onAttachImages: (files: File[]) => void;
  onSend: () => void;
  /** 运行中排队发送：等价 Enter（默认稍后；输入 /steer 时插话）（docs/design/73）。 */
  onQueueSend: () => void;
  onStop: () => void;
}

/** 底部工具栏：+ / 访问模式 / 模型 / 思考档位 / 发送（docs/用户对话栏/4–7、docs/design/14）。 */
export function TaskInputToolbar({
  running,
  canSend,
  onPlusAction,
  onAttachImages,
  onSend,
  onQueueSend,
  onStop,
}: ToolbarProps) {
  const t = useT();
  const { thinkingLevel, thinkingLevels, setThinkingLevel } = useComposerStore();
  const { modelLabel, processAlive, refreshModelState } = useSessionMeta();
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  const onAttachInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // 允许再次选同一文件：必须清 value，否则 change 不触发
      event.target.value = "";
      if (files.length > 0) onAttachImages(files);
    },
    [onAttachImages],
  );

  return (
    <div className={styles.toolbar}>
      {/* 系统选附件（docs/design/21 + 25）：任意文件；图片走 ImageContent，其余走路径引用 */}
      <input
        ref={attachInputRef}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={onAttachInputChange}
      />
      <Menu
        direction="top"
        align="left"
        trigger={({ onClick }) => (
          <button
            type="button"
            className={styles.iconBtn}
            title={t("session.input.more")}
            onClick={onClick}
          >
            <Plus size={18} weight="regular" />
          </button>
        )}
        items={[
          {
            key: "attach",
            label: t("session.input.attach"),
            icon: <Paperclip size={16} weight="regular" />,
            onSelect: () => attachInputRef.current?.click(),
          },
          {
            key: "mention",
            label: t("session.input.mention"),
            icon: <AtIcon size={16} />,
            onSelect: () => onPlusAction("mention"),
          },
          {
            key: "slash",
            label: t("session.input.slash"),
            icon: <ListMagnifyingGlass size={16} weight="regular" />,
            onSelect: () => onPlusAction("slash"),
          },
        ]}
      />

      <AccessModeChip running={running} />

      <div className={styles.spacer} />

      {running && (
        <span className={styles.runningMark} title={t("session.input.running")}>
          <Spinner size={16} weight="regular" className={styles.spin} />
        </span>
      )}

      <ContextUsageChip />
      <ModelMenu label={modelLabel} />
      <ThinkingChip
        level={thinkingLevel}
        levels={thinkingLevels}
        onChange={setThinkingLevel}
        onOpen={() => void refreshModelState()}
        alive={processAlive}
      />

      {running && canSend && (
        <button
          type="button"
          className={styles.queueSendBtn}
          title={t("session.queue.sendHint")}
          aria-label={t("session.queue.send")}
          onClick={onQueueSend}
        >
          <PaperPlaneRight size={18} weight="regular" />
        </button>
      )}
      <SendButton running={running} canSend={canSend} onSend={onSend} onStop={onStop} />
    </div>
  );
}

/** 扩展可引用的宿主内置模式图标（placementHint.mode.icon，docs/design/14）。 */
const ACCESS_MODE_ICONS: Record<AccessModeIconName, React.ReactNode> = {
  shield: <Shield size={18} weight="regular" />,
  "shield-check": <ShieldCheck size={18} weight="regular" />,
  clipboard: <ClipboardText size={18} weight="regular" />,
};

function accessModeIcon(name: string | undefined, fallback: React.ReactNode): React.ReactNode {
  if (name && Object.hasOwn(ACCESS_MODE_ICONS, name)) {
    return ACCESS_MODE_ICONS[name as AccessModeIconName];
  }
  return fallback;
}

interface AccessModeRow {
  key: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  active: boolean;
  onSelect?: () => void;
}

/**
 * 访问模式芯片（docs/design/14 + docs/design/16）：
 * Catalog 提供冷态入口；live 真值在扩展侧。三态：
 * confirmed-full / confirmed-extension / unresolved。
 * unresolved 时不把「完全访问」勾成已确认。
 */
function AccessModeChip({ running }: { running: boolean }) {
  const t = useT();
  const {
    accessModeRows,
    accessModeSelection,
    accessModeChip,
    accessModeError,
    modeTransitioning,
    sendAction,
    activateAccessMode,
  } = useExtensionViewStore();
  const { ensureSession } = useSessionMeta();

  const selectRow = async (row: (typeof accessModeRows)[number]): Promise<void> => {
    if (modeTransitioning || running) return;
    if (!row.contributionKey && row.state === "live" && row.liveViewId) {
      // live 路径：直接经 Host 发到扩展
      if (row.liveActive) return;
      sendAction(row.liveViewId, ACCESS_MODE_ACTIONS.activate, {});
      return;
    }
    if (!row.contributionKey) return;
    if (row.state === "activating") return;
    void activateAccessMode({
      contributionKey: row.contributionKey,
      actionId: "mode:activate",
      prepareSession: () => ensureSession("view-action"),
    });
  };

  const selectFull = (): void => {
    if (modeTransitioning || running) return;
    if (accessModeSelection !== "confirmed-extension") return;
    const activeLive = accessModeRows.find((r) => r.state === "live" && r.liveActive);
    if (!activeLive?.contributionKey && activeLive?.liveViewId) {
      sendAction(activeLive.liveViewId, ACCESS_MODE_ACTIONS.deactivate, {});
      return;
    }
    if (activeLive?.contributionKey) {
      void activateAccessMode({
        contributionKey: activeLive.contributionKey,
        actionId: "mode:deactivate",
        prepareSession: () => ensureSession("view-action"),
      });
    }
  };

  const stateLabel = (row: (typeof accessModeRows)[number]): string => {
    switch (row.state) {
      case "advertised":
        return row.description ?? t("session.access.notConnected");
      case "activating":
        return t("session.access.starting");
      case "failed":
        return row.error ?? t("session.access.activateFailed");
      case "suspended":
        return row.suspendedLabel ?? t("session.access.suspended");
      case "live":
        return row.liveActive && row.detail ? row.detail : (row.description ?? "");
      default:
        return row.description ?? "";
    }
  };

  const rows: AccessModeRow[] = [
    {
      key: "full",
      title: t("session.access.full"),
      desc:
        accessModeSelection === "confirmed-full"
          ? t("session.access.fullDesc")
          : accessModeSelection === "unresolved"
            ? t("session.access.unresolved")
            : t("session.access.fullDesc"),
      icon: <ShieldCheck size={18} weight="regular" />,
      active: accessModeSelection === "confirmed-full",
      onSelect: accessModeSelection === "confirmed-extension" ? selectFull : undefined,
    },
    ...accessModeRows.map(
      (row): AccessModeRow => ({
        key: row.contributionKey ?? row.key,
        title: row.state === "suspended" && row.suspendedLabel ? row.suspendedLabel : row.title,
        desc: stateLabel(row),
        icon: accessModeIcon(row.icon, <ClipboardText size={18} weight="regular" />),
        active: row.state === "live" && row.liveActive,
        onSelect: () => {
          void selectRow(row);
        },
      }),
    ),
  ];

  return (
    <Popover
      direction="top"
      align="left"
      trigger={({ onClick }) => (
        <button
          type="button"
          className={[
            styles.accessChip,
            accessModeSelection === "confirmed-extension" ? styles.accessChipActive : "",
          ].join(" ")}
          onClick={onClick}
          // 窄宽度下不再展示文案，模式名/切换状态收进 tooltip + aria
          title={
            accessModeError ??
            (modeTransitioning ? t("session.access.switching") : accessModeChip.title)
          }
          aria-label={modeTransitioning ? t("session.access.switching") : accessModeChip.title}
        >
          {accessModeSelection === "confirmed-extension" ? (
            accessModeIcon(
              accessModeRows.find((r) => r.liveActive)?.icon,
              <Shield size={16} weight="regular" />,
            )
          ) : accessModeSelection === "unresolved" ? (
            <Shield size={16} weight="regular" />
          ) : (
            <ShieldCheck size={16} weight="regular" />
          )}
          <GlideChevron size={14} />
        </button>
      )}
    >
      <div className={styles.modePanel}>
        {accessModeError ? <div className={styles.modeNote}>{accessModeError}</div> : null}
        <OptionList
          rows={rows.map<OptionRow>((item) => ({
            key: item.key,
            className: styles.modeRow,
            disabled: running || modeTransitioning,
            title: running ? t("session.access.waitUntilIdle") : undefined,
            selected: item.active,
            text: item.title,
            node: (
              <>
                <span className={styles.modeIcon}>{item.icon}</span>
                <span className={styles.modeText}>
                  <span className={styles.modeTitle}>{item.title}</span>
                  <span className={styles.modeDesc}>{item.desc}</span>
                </span>
                {item.active && <Check size={16} weight="regular" className={styles.check} />}
              </>
            ),
          }))}
          role="listbox"
          ariaLabel={accessModeChip.title}
          className={styles.modeList}
          onSelect={(index) => rows[index]?.onSelect?.()}
        />
      </div>
    </Popover>
  );
}

function ThinkingChip({
  level,
  levels,
  onChange,
  onOpen,
  alive,
}: {
  level: ThinkingLevelId;
  levels: ThinkingLevelId[];
  onChange: (level: ThinkingLevelId) => void;
  /** 打开浮层时拉一次真值：预热会话 / 扩展改档后芯片不必等下一次切会话才更新。 */
  onOpen: () => void;
  alive: boolean;
}) {
  const t = useT();
  // 顶档 = 该模型可用档位的最高档（与滑轨 fill/thumb 的 data-max 同口径）
  const maxed = levels.length > 1 && level === levels[levels.length - 1];

  const apply = (next: ThinkingLevelId): void => {
    onChange(next);
    if (alive) void sessionService.setThinkingLevel(next).catch(() => undefined);
  };

  return (
    <Popover
      direction="top"
      align="right"
      trigger={({ onClick, open }) => (
        <button
          type="button"
          className={[styles.thinkingChip, maxed ? styles.thinkingChipMax : ""].join(" ")}
          title={t("session.input.thinkingLevel")}
          onClick={() => {
            if (!open) onOpen();
            onClick();
          }}
        >
          <Sparkle size={14} weight="regular" />
          {t(THINKING_LABEL_KEY[level])}
          <GlideChevron size={12} />
        </button>
      )}
    >
      <ThinkingLevelSlider
        levels={levels}
        value={level}
        onChange={apply}
        title={t("session.input.thinkingLevel")}
        valueLabel={t(THINKING_LABEL_KEY[level])}
      />
    </Popover>
  );
}

/**
 * 输入栏模型展示名：恒不显示 provider 前缀（如 `newapi/gpt-5.6-luna` → `gpt-5.6-luna`）。
 * 只剥第一段 `/`，modelId 自身含 `/` 时保留后续。
 */
function displayModelLabel(label: string): string {
  const slash = label.indexOf("/");
  return slash >= 0 ? label.slice(slash + 1) : label;
}

/** 当前 modelLabel 与列表项是否同一模型（label 可能是展示名或 provider/id，可能带 :thinking 后缀）。 */
function isSameModel(label: string, model: PiModelOption): boolean {
  if (!label || label === "pi") return false;
  const key = `${model.provider}/${model.modelId}`;
  const base = label.split(":")[0]?.trim() ?? label;
  return base === key || base === model.label || label === key || label === model.label;
}

/** 输入栏模型下拉：打开时拉取凭据可用模型，选中即切换（无会话则写默认模型）。 */
const ModelMenu = memo(function ModelMenu({ label }: { label: string }) {
  const t = useT();
  const { refreshModelState, refreshContextUsage } = useSessionMeta();
  const { showToast } = useUiStore();
  const [models, setModels] = useState<PiModelOption[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshModels = useCallback(() => {
    setLoading(true);
    // force：切换凭据后绕过会话快照/网关缓存；严格按激活 provider 过滤，禁止回退全量
    Promise.all([sessionService.getModels({ force: true }), authService.list()])
      .then(([list, auth]) => {
        const active = auth?.activeProvider ?? null;
        setModels(active ? list.filter((m) => m.provider === active) : list);
      })
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, []);

  const applyModel = useCallback(
    async (model: PiModelOption) => {
      try {
        const next = await sessionService.setModel(model.provider, model.modelId);
        await refreshModelState();
        void refreshContextUsage();
        if (next.sessionApplied === false) {
          showToast(t("session.model.savedDefault", { label: next.label }));
        } else {
          showToast(t("session.model.switched", { label: next.label }));
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : t("session.model.switchFailed"));
      }
    },
    [refreshModelState, refreshContextUsage, showToast, t],
  );

  // 列表已有模型时，后台刷新（loading 翻转）不该重建上百个条目与图标
  const menuState: "ready" | "loading" | "empty" =
    models.length > 0 ? "ready" : loading ? "loading" : "empty";

  const items: MenuItem[] = useMemo(() => {
    if (menuState !== "ready") {
      const isLoading = menuState === "loading";
      return [
        {
          key: isLoading ? "__loading" : "__empty",
          label: t(isLoading ? "session.model.loading" : "session.model.empty"),
          disabled: true,
        },
      ];
    }
    return models.map((model) => {
      const key = `${model.provider}/${model.modelId}`;
      return {
        key,
        label: model.label,
        icon: <AiModelIcon provider={model.provider} modelId={model.modelId} size={16} />,
        selected: isSameModel(label, model),
        hint: isSameModel(label, model) ? t("session.model.current") : undefined,
        onSelect: () => void applyModel(model),
      };
    });
  }, [menuState, models, label, applyModel, t]);

  return (
    <Menu
      direction="top"
      align="right"
      trigger={({ onClick, open }) => (
        <button
          type="button"
          className={styles.modelChip}
          title={t("session.model.switch")}
          onClick={() => {
            if (!open) refreshModels();
            onClick();
          }}
        >
          <span className={styles.modelLabel}>
            {displayModelLabel(label) || t("session.model.select")}
          </span>
          <GlideChevron size={14} />
        </button>
      )}
      items={items}
    />
  );
});
