import { DotsThreeVertical, Warning } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { TranslateFn } from "../../../shared/i18n";
import type { McpExposure, McpServerEntry, McpServerReport } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { type Gsap, loadGsap, prefersReducedMotion } from "../../utils/animation";
import { NAV_MOTION } from "../../utils/motionTokens";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";
import { Toggle } from "../ui/Toggle";
import styles from "./McpServerCard.module.css";

export type McpCardAction = "login" | "logout" | "reconnect";

/** 快速连点时终止上一轮高度补间，只需要 kill 能力。 */
type ActiveTween = ReturnType<Gsap["to"]> | null;

/**
 * 工具 chips：默认单行截断，行尾「展开全部 N 个」点击全量展开，再次点击收起。
 * 截断按宽度不按数量：chips 不换行不收缩、超出即被裁切，ResizeObserver 实测
 * clip 容器横向溢出才挂按钮；展开/收起对整块做 GSAP 实测像素高度补间
 * （收起单行与展开多行是两种布局，切换前后各量一次高，遵循动效规范）。
 */
function ToolChips({ tools }: { tools: string[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const startHeightRef = useRef<number | null>(null);
  const tweenRef = useRef<ActiveTween>(null);

  useLayoutEffect(() => {
    // 展开态整行换行展示，无「截断」概念，无需测量
    if (expanded) return;
    const clip = clipRef.current;
    const inner = innerRef.current;
    if (!clip || !inner) return;
    const check = () => {
      // 1px 容差吸收 offsetWidth/clientWidth 的取整误差
      setOverflowing(inner.offsetWidth > clip.clientWidth + 1);
    };
    check();
    // 同时观察裁切壳（卡片/按钮增减改变可用宽度）与内容行（工具清单变化改变内容宽度）
    const observer = new ResizeObserver(check);
    observer.observe(clip);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [expanded]);

  useLayoutEffect(() => {
    const start = startHeightRef.current;
    startHeightRef.current = null;
    const el = blockRef.current;
    if (start === null || !el) return;
    const clearInline = () => {
      el.style.removeProperty("height");
      el.style.removeProperty("overflow");
      el.style.removeProperty("will-change");
    };
    // 上一轮补间可能残留内联高度，先清掉才能量到自然高度
    clearInline();
    const to = el.offsetHeight;
    if (to === start || prefersReducedMotion()) return;
    el.style.overflow = "hidden";
    el.style.willChange = "height";
    el.style.height = `${start}px`;
    let cancelled = false;
    void loadGsap().then((gsap) => {
      if (cancelled || !el.isConnected) {
        clearInline();
        return;
      }
      tweenRef.current = gsap.to(el, {
        height: to,
        duration: expanded ? NAV_MOTION.collapseEnter : NAV_MOTION.collapseExit,
        ease: expanded ? NAV_MOTION.easeOut : NAV_MOTION.easeIn,
        onComplete: () => {
          tweenRef.current = null;
          clearInline();
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  const toggle = () => {
    const el = blockRef.current;
    if (el) {
      tweenRef.current?.kill();
      tweenRef.current = null;
      el.style.removeProperty("height");
      el.style.removeProperty("overflow");
      el.style.removeProperty("will-change");
      // 记录切换前的实际高度，layout effect 量出目标高度后从它补间
      startHeightRef.current = el.offsetHeight;
    }
    setExpanded((value) => !value);
  };

  const chips = tools.map((tool) => (
    <span key={tool} className={styles.toolChip} title={tool}>
      {tool}
    </span>
  ));
  return (
    <div ref={blockRef} className={styles.toolChipsBlock}>
      {expanded ? (
        <div className={styles.toolChips}>
          {chips}
          <button type="button" className={styles.toolChipsToggle} aria-expanded onClick={toggle}>
            {t("mcp.card.toolChips.collapse")}
          </button>
        </div>
      ) : (
        <div className={styles.toolChipsRow}>
          <div ref={clipRef} className={styles.toolChipsClip}>
            <div ref={innerRef} className={`${styles.toolChips} ${styles.toolChipsFit}`}>
              {chips}
            </div>
          </div>
          {overflowing ? (
            <button
              type="button"
              className={styles.toolChipsToggle}
              aria-expanded={false}
              onClick={toggle}
            >
              {t("mcp.card.toolChips.showAll", { count: tools.length })}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

interface McpServerCardProps {
  name: string;
  config: McpServerEntry;
  /** `pi mcp list --json` 的对应报告；未探测或项目级缺失条目时为 null。 */
  report: McpServerReport | null;
  /** 探测完成时间（Unix ms）；null = 未探测过。 */
  probedAt: number | null;
  busy: boolean;
  /** 是否存在活跃 pi 会话（/mcp login 等会话内动作的前置）。 */
  hasLiveSession: boolean;
  /** 只读展示（项目级条目）：不提供编辑 / 启停等本地配置动作。 */
  readOnly?: boolean;
  /**
   * 冻结展示（宿主 pi 不支持 MCP 的降级，docs/design/39）：与只读相同的视觉，
   * 但卡片仍属用户级配置，不带「项目级」徽标。
   */
  actionsDisabled?: boolean;
  /** mcp.json 中的非对象条目：仅保留删除，引导用户重建或手动修复。 */
  invalid?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onSetEnabled?: (enabled: boolean) => void;
  onSetExposure?: (exposure: McpExposure) => void;
  onAction?: (action: McpCardAction) => void;
  onCopyLoginCommand?: () => void;
}

/** OAuth 应用于无 Authorization 头的 HTTP server（pi docs/mcp.md）。 */
function needsLogin(config: McpServerEntry, report: McpServerReport | null): boolean {
  if (report?.state === "needs-auth") return true;
  return Boolean(config.url) && !config.headers?.Authorization && !config.headers?.authorization;
}

/** 探测距今的相对时间（徽标 hover 提示用）；快照写死在渲染时，不做实时倒计时。 */
function formatProbedAgo(t: TranslateFn, probedAt: number): string {
  const minutes = Math.floor((Date.now() - probedAt) / 60_000);
  if (minutes < 1) return t("mcp.page.probedJustNow");
  if (minutes < 60) return t("mcp.page.probedMinutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("mcp.page.probedHoursAgo", { count: hours });
  return t("mcp.page.probedDaysAgo", { count: Math.floor(hours / 24) });
}

function StateBadge({ state, title }: { state: string; title?: string }) {
  const t = useT();
  const toneClass =
    state === "connected"
      ? styles.stateConnected
      : state === "needs-auth" || state === "failed"
        ? styles.stateAttention
        : styles.stateMuted;
  return (
    <span className={`${styles.stateBadge} ${toneClass}`} title={title}>
      <span className={styles.stateDot} aria-hidden />
      {t(`mcp.state.${state}`)}
    </span>
  );
}

/** 单个 MCP server 卡片：配置摘要 + 状态徽标 + 暴露级别 + 行菜单。 */
export function McpServerCard({
  name,
  config,
  report,
  probedAt,
  busy,
  hasLiveSession,
  readOnly = false,
  actionsDisabled = false,
  invalid = false,
  onEdit,
  onRemove,
  onSetEnabled,
  onSetExposure,
  onAction,
  onCopyLoginCommand,
}: McpServerCardProps) {
  const t = useT();
  const frozen = readOnly || actionsDisabled;
  const transport =
    config.url ?? [config.command, ...(config.args ?? [])].filter(Boolean).join(" ");
  const enabled = config.enabled !== false;
  // 工具计数只在已连接时有意义：needs-auth / failed 的「0 个工具」是没连上，不是没工具
  const toolsParts: string[] = [];
  if (report && report.state === "connected") {
    toolsParts.push(t("mcp.card.tools", { count: report.tools.length }));
    if (typeof report.resources === "number" && report.resources > 0) {
      toolsParts.push(t("mcp.card.resources", { count: report.resources }));
    }
  }
  const loginAvailable = needsLogin(config, report);
  const probedAgoTitle = probedAt !== null ? formatProbedAgo(t, probedAt) : undefined;

  const removeItem = {
    key: "remove",
    label: t("mcp.card.menu.remove"),
    tone: "danger" as const,
    onSelect: onRemove,
    disabled: !onRemove || busy,
  };
  const menuItems = invalid
    ? [removeItem]
    : [
        {
          key: "edit",
          label: t("mcp.card.menu.edit"),
          onSelect: onEdit,
          disabled: !onEdit || busy,
        },
        {
          key: "login",
          label: t("mcp.card.menu.login"),
          onSelect: () => onAction?.("login"),
          disabled: busy || !loginAvailable || !hasLiveSession,
          hint: !hasLiveSession
            ? t("mcp.card.menu.needsLiveSession")
            : !loginAvailable
              ? !config.url
                ? t("mcp.card.menu.needsHttpServer")
                : t("mcp.card.menu.authConfigured")
              : undefined,
        },
        {
          key: "logout",
          label: t("mcp.card.menu.logout"),
          onSelect: () => onAction?.("logout"),
          disabled: busy || !config.url || !hasLiveSession,
          hint: !hasLiveSession
            ? t("mcp.card.menu.needsLiveSession")
            : !config.url
              ? t("mcp.card.menu.needsHttpServer")
              : undefined,
        },
        {
          key: "reconnect",
          label: t("mcp.card.menu.reconnect"),
          onSelect: () => onAction?.("reconnect"),
          disabled: busy || !hasLiveSession,
          hint: !hasLiveSession ? t("mcp.card.menu.needsLiveSession") : undefined,
        },
        {
          key: "copyCommand",
          label: t("mcp.card.menu.copyLoginCommand"),
          onSelect: onCopyLoginCommand,
          disabled: !config.url || !onCopyLoginCommand,
          hint: !config.url ? t("mcp.card.menu.needsHttpServer") : undefined,
        },
        removeItem,
      ];

  return (
    <div className={[styles.card, frozen ? styles.cardReadOnly : ""].join(" ")}>
      <div className={styles.header}>
        <span className={styles.name}>{name}</span>
        {readOnly ? <span className={styles.badge}>{t("mcp.card.scope.project")}</span> : null}
        {report?.override ? <span className={styles.badge}>{t("mcp.card.overridden")}</span> : null}
        {!enabled ? <span className={styles.badgeMuted}>{t("mcp.state.disabled")}</span> : null}
        <span className={styles.headerSpacer} />
        <StateBadge
          state={report ? report.state : probedAt !== null ? "unknown" : "notProbed"}
          title={probedAgoTitle}
        />
        {!frozen ? (
          <Menu
            align="right"
            trigger={({ onClick }) => (
              <IconButton title={t("common.more")} disabled={busy} onClick={onClick}>
                <DotsThreeVertical size={16} weight="regular" />
              </IconButton>
            )}
            items={menuItems}
          />
        ) : null}
      </div>

      {transport ? <div className={styles.transport}>{transport}</div> : null}
      {config.description ? <div className={styles.description}>{config.description}</div> : null}

      {!invalid ? (
        <div className={styles.meta}>
          <span className={styles.exposureLabel}>
            <span>{t("mcp.card.exposureLabel")}</span>
            {frozen ? (
              <span className={styles.exposureValue}>
                {t(`mcp.exposure.${config.exposure ?? "codemode"}`)}
              </span>
            ) : (
              <select
                className={styles.exposureSelect}
                value={config.exposure ?? "codemode"}
                disabled={busy}
                aria-label={t("mcp.card.exposureLabel")}
                onChange={(event) => onSetExposure?.(event.target.value as McpExposure)}
              >
                {(["codemode", "deferred", "direct", "hidden"] as const).map((exposure) => (
                  <option
                    key={exposure}
                    value={exposure}
                    title={t(`mcp.exposure.${exposure}.hint`)}
                  >
                    {t(`mcp.exposure.${exposure}`)}
                  </option>
                ))}
              </select>
            )}
          </span>
          {toolsParts.length > 0 ? (
            <span className={styles.tools}>{toolsParts.join(" · ")}</span>
          ) : null}
          {!frozen && onSetEnabled ? (
            <span className={styles.enabledLabel}>
              {/* 裸 Toggle 看不出控制什么：补可见标签并经 aria-labelledby 关联（docs/design/40 优化 2） */}
              <span className={styles.enabledText} id={`mcp-enabled-${name}`}>
                {t("mcp.card.enabled")}
              </span>
              <Toggle
                checked={enabled}
                disabled={busy}
                aria-labelledby={`mcp-enabled-${name}`}
                onChange={onSetEnabled}
              />
            </span>
          ) : null}
        </div>
      ) : null}

      {report && (report.tools.length > 0 || report.state === "connected") ? (
        report.tools.length > 0 ? (
          <ToolChips tools={report.tools} />
        ) : (
          <p className={styles.noTools}>{t("mcp.card.noTools")}</p>
        )
      ) : null}

      {report?.toolExposure && Object.keys(report.toolExposure).length > 0 ? (
        <div className={styles.hintLine}>
          {t("mcp.card.toolExposureHint", { count: Object.keys(report.toolExposure).length })}
        </div>
      ) : null}
      {invalid ? (
        <div className={styles.errorLine}>
          <Warning size={16} weight="regular" />
          <span>{t("mcp.card.invalidEntry")}</span>
        </div>
      ) : report?.error ? (
        <div className={styles.errorLine}>
          <Warning size={16} weight="regular" />
          <span>{report.error}</span>
        </div>
      ) : null}
    </div>
  );
}
