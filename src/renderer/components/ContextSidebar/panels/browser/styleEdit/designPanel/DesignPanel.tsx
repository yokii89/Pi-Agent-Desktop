import {
  ArrowClockwise,
  ArrowDown,
  ArrowRight,
  ArrowsDownUp,
  ArrowsLeftRight,
  Crosshair,
  Drop,
  Eye,
  FlipHorizontal,
  FlipVertical,
  GridFour,
  Link,
  LinkBreak,
  Palette,
  Plus,
  Square,
  TextAlignCenter,
  TextAlignJustify,
  TextAlignLeft,
  TextAlignRight,
  Trash,
} from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { useT } from "../../../../../../hooks/useT";
import { useInspectorStore } from "../../../../../../stores/inspectorStore";
import { useStyleEditStore } from "../../../../../../stores/styleEditStore";
import { ColorInput } from "../ColorInput";
import { CommitTextField } from "./CommitTextField";
import { DenseRow, DesignField, FieldPair, FieldTriple } from "./DesignField";
import { DesignSection } from "./DesignSection";
import { DesignSelect } from "./DesignSelect";
import styles from "./designPanel.module.css";
import {
  type AlignMode,
  alignModeToValue,
  colorAlphaToPercent,
  colorWithAlpha,
  FIELD_BG_COLOR,
  FIELD_BORDER_COLOR,
  FIELD_BORDER_STYLE,
  FIELD_BORDER_WIDTH,
  FIELD_BOX_SHADOW,
  FIELD_COLOR,
  FIELD_FILTER,
  FIELD_FONT,
  FIELD_H,
  FIELD_LETTER_SPACING,
  FIELD_LINE_HEIGHT,
  FIELD_OPACITY,
  FIELD_RADIUS,
  FIELD_ROTATE,
  FIELD_SIZE,
  FIELD_W,
  FIELD_WEIGHT,
  FIELD_X,
  FIELD_Y,
  FIELD_Z,
  type FlowMode,
  FONT_OPTIONS,
  flowModeToDecls,
  isBorderBox,
  joinLength,
  normalizeProp,
  opacityToCss,
  opacityToDisplay,
  PAIR_PROPS,
  resolveAlignMode,
  resolveDisplayValue,
  resolveFlowMode,
  resolvePairValue,
  rotateToDisplay,
  splitLength,
} from "./designSchema";
import { SegmentButtons, SegmentIconBtn } from "./SegmentButtons";
import { SwatchOnly } from "./SwatchOnly";
import { UnitField } from "./UnitField";

/**
 * 「设计」模式（拾取后自动填入 CSS 数值，手调热更）。
 * 能并一行的字段尽量并一行（窄侧栏密度优先）。
 */

export interface DesignPanelProps {
  disabled?: boolean;
}

export function DesignPanel({ disabled }: DesignPanelProps) {
  const t = useT();
  const { styles: data, loading, stale } = useInspectorStore();
  const edit = useStyleEditStore();
  const [paddingLinked, setPaddingLinked] = useState(true);
  const [marginLinked, setMarginLinked] = useState(true);

  const computedMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data?.computed ?? []) map.set(normalizeProp(item.name), item.value);
    return map;
  }, [data]);

  const decls = edit.currentDeclarations;
  const canEdit = !disabled && edit.currentNodeId !== null && !stale;

  const val = useCallback(
    (prop: string) => resolveDisplayValue(prop, computedMap, decls),
    [computedMap, decls],
  );
  const pairVal = useCallback(
    (props: readonly [string, string]) => resolvePairValue(props, computedMap, decls),
    [computedMap, decls],
  );
  const isAdjusted = useCallback(
    (prop: string) => {
      const key = normalizeProp(prop);
      return decls.some((decl) => decl.enabled && normalizeProp(decl.name) === key);
    },
    [decls],
  );
  const isPairAdjusted = useCallback(
    (props: readonly [string, string]) => isAdjusted(props[0]) || isAdjusted(props[1]),
    [isAdjusted],
  );

  const setOne = useCallback(
    (prop: string, value: string): void => {
      if (!canEdit || !value.trim()) return;
      edit.upsertDeclaration(prop, value.trim());
    },
    [canEdit, edit],
  );

  const setMany = useCallback(
    (entries: Array<{ name: string; value: string }>): void => {
      if (!canEdit) return;
      edit.upsertDeclarations(entries);
    },
    [canEdit, edit],
  );

  const setLengthField = useCallback(
    (prop: string, display: string, unit: string): void => {
      const trimmed = display.trim();
      if (!canEdit || !trimmed) return;
      const css =
        trimmed === "auto" || trimmed === "inherit" || trimmed === "unset"
          ? trimmed
          : /^\d*\.?\d+$/.test(trimmed)
            ? joinLength(trimmed, unit)
            : trimmed;
      setOne(prop, css);
    },
    [canEdit, setOne],
  );

  const lengthDisplay = useCallback(
    (prop: string): string => {
      const raw = val(prop);
      if (!raw || raw === "auto") return "";
      const { num } = splitLength(raw);
      return num === "auto" ? "" : num;
    },
    [val],
  );

  const pairDisplay = useCallback(
    (props: readonly [string, string]): string => {
      const raw = pairVal(props);
      if (!raw || raw === "auto") return "";
      const { num } = splitLength(raw);
      return num === "auto" ? "" : num;
    },
    [pairVal],
  );

  const numberDisplay = useCallback(
    (prop: string, keyword = "normal"): string => {
      const raw = val(prop);
      if (!raw || raw === keyword) return "";
      const { num } = splitLength(raw);
      return num === keyword ? "" : num;
    },
    [val],
  );

  const onPairSide = (
    props: readonly [string, string],
    all: readonly string[],
    display: string,
    linked: boolean,
  ): void => {
    const trimmed = display.trim();
    if (!canEdit || !trimmed) return;
    const css = /^\d*\.?\d+$/.test(trimmed) ? joinLength(trimmed, "px") : trimmed;
    const targets = linked ? all : props;
    setMany(targets.map((name) => ({ name, value: css })));
  };

  if (loading && !data) {
    return <p className={styles.empty}>{t("browser.styles.loading")}</p>;
  }
  if (!data) {
    return (
      <p className={styles.empty}>
        {stale ? t("browser.styles.stale") : t("browser.styles.noSelectionHint")}
      </p>
    );
  }

  const flow = resolveFlowMode(val("display"), val("flex-direction"));
  const align = resolveAlignMode(val("text-align"));
  const rotateDisplay = rotateToDisplay(val(FIELD_ROTATE.prop), val("transform"));
  const opacityDisplay = opacityToDisplay(val(FIELD_OPACITY.prop) || "1");
  const radiusRaw = val(FIELD_RADIUS.prop);
  const radiusDisplay = (() => {
    if (!radiusRaw) return "";
    const first = splitLength(radiusRaw.split(/\s+/)[0] ?? "");
    return first.num === "auto" ? "" : first.num;
  })();
  const borderBox = isBorderBox(val("box-sizing"));
  const bgColor = val(FIELD_BG_COLOR.prop);
  const bgAlpha = colorAlphaToPercent(bgColor || "rgba(0, 0, 0, 0)");
  const fontValue = val(FIELD_FONT.prop).replace(/^["']|["']$/g, "");

  const onFlow = (mode: FlowMode): void => setMany(flowModeToDecls(mode));
  const onAlign = (mode: AlignMode): void => setOne("text-align", alignModeToValue(mode));

  return (
    <div className={styles.root}>
      {/* 位置：X|Y|Z 一行，旋转+动作一行 */}
      <DesignSection
        title={t("browser.design.position")}
        actions={
          <button
            type="button"
            className={[styles.iconBtn, styles.iconBtnBordered].join(" ")}
            title={t("browser.design.resetSection")}
            disabled={!canEdit}
            onClick={() =>
              edit.removeDeclarations([FIELD_X.prop, FIELD_Y.prop, FIELD_Z.prop, FIELD_ROTATE.prop])
            }
          >
            <Crosshair size={14} weight="regular" />
          </button>
        }
      >
        <FieldTriple>
          <DesignField label="X" short>
            <UnitField
              value={lengthDisplay(FIELD_X.prop)}
              unit="px"
              placeholder={FIELD_X.placeholder}
              disabled={!canEdit}
              adjusted={isAdjusted(FIELD_X.prop)}
              onChange={(v) => setLengthField(FIELD_X.prop, v, "px")}
            />
          </DesignField>
          <DesignField label="Y" short>
            <UnitField
              value={lengthDisplay(FIELD_Y.prop)}
              unit="px"
              placeholder={FIELD_Y.placeholder}
              disabled={!canEdit}
              adjusted={isAdjusted(FIELD_Y.prop)}
              onChange={(v) => setLengthField(FIELD_Y.prop, v, "px")}
            />
          </DesignField>
          <DesignField label="Z" short>
            <UnitField
              value={lengthDisplay(FIELD_Z.prop)}
              placeholder={FIELD_Z.placeholder}
              disabled={!canEdit}
              adjusted={isAdjusted(FIELD_Z.prop)}
              onChange={(v) => setLengthField(FIELD_Z.prop, v, "")}
            />
          </DesignField>
        </FieldTriple>

        <DenseRow
          label={t("browser.design.rotate")}
          action={
            <>
              <SegmentIconBtn
                title={t("browser.design.rotateReset")}
                disabled={!canEdit}
                onClick={() => edit.removeDeclarations([FIELD_ROTATE.prop])}
              >
                <ArrowClockwise size={14} weight="regular" />
              </SegmentIconBtn>
              <SegmentIconBtn
                title={t("browser.design.flipH")}
                disabled={!canEdit}
                onClick={() => setOne("transform", "scaleX(-1)")}
              >
                <FlipHorizontal size={14} weight="regular" />
              </SegmentIconBtn>
              <SegmentIconBtn
                title={t("browser.design.flipV")}
                disabled={!canEdit}
                onClick={() => setOne("transform", "scaleY(-1)")}
              >
                <FlipVertical size={14} weight="regular" />
              </SegmentIconBtn>
            </>
          }
        >
          <UnitField
            value={rotateDisplay === "0" ? "" : rotateDisplay}
            unit="deg"
            placeholder="0"
            disabled={!canEdit}
            adjusted={isAdjusted(FIELD_ROTATE.prop)}
            onChange={(v) => {
              const trimmed = v.trim();
              if (!trimmed) return;
              setOne(FIELD_ROTATE.prop, /^\d*\.?\d+$/.test(trimmed) ? `${trimmed}deg` : trimmed);
            }}
          />
        </DenseRow>
      </DesignSection>

      {/* 布局：Flow 一行 · W|H 一行 · Pad/Mar 各一行 · Border box */}
      <DesignSection title={t("browser.design.layout")}>
        <DenseRow label={t("browser.design.flow")}>
          <SegmentButtons
            ariaLabel={t("browser.design.flow")}
            value={flow}
            onChange={onFlow}
            disabled={!canEdit}
            options={[
              {
                value: "block",
                title: t("browser.design.flow.block"),
                icon: <Square size={15} weight="regular" />,
              },
              {
                value: "row",
                title: t("browser.design.flow.row"),
                icon: <ArrowRight size={15} weight="regular" />,
              },
              {
                value: "column",
                title: t("browser.design.flow.column"),
                icon: <ArrowDown size={15} weight="regular" />,
              },
              {
                value: "grid",
                title: t("browser.design.flow.grid"),
                icon: <GridFour size={15} weight="regular" />,
              },
            ]}
          />
        </DenseRow>

        <FieldPair>
          <DesignField label="W" short>
            <UnitField
              value={lengthDisplay(FIELD_W.prop)}
              unit="px"
              placeholder={FIELD_W.placeholder}
              disabled={!canEdit}
              adjusted={isAdjusted(FIELD_W.prop)}
              onChange={(v) => setLengthField(FIELD_W.prop, v, "px")}
            />
          </DesignField>
          <DesignField label="H" short>
            <UnitField
              value={lengthDisplay(FIELD_H.prop)}
              unit="px"
              placeholder={FIELD_H.placeholder}
              disabled={!canEdit}
              adjusted={isAdjusted(FIELD_H.prop)}
              onChange={(v) => setLengthField(FIELD_H.prop, v, "px")}
            />
          </DesignField>
        </FieldPair>

        <PairBlock
          title={t("browser.design.padding")}
          linked={paddingLinked}
          onToggleLink={() => setPaddingLinked((prev) => !prev)}
          linkTitle={paddingLinked ? t("browser.design.unlink") : t("browser.design.link")}
          canEdit={canEdit}
          hValue={pairDisplay(PAIR_PROPS.paddingH)}
          vValue={pairDisplay(PAIR_PROPS.paddingV)}
          hAdjusted={isPairAdjusted(PAIR_PROPS.paddingH)}
          vAdjusted={isPairAdjusted(PAIR_PROPS.paddingV)}
          onH={(v) =>
            onPairSide(
              PAIR_PROPS.paddingH,
              [...PAIR_PROPS.paddingH, ...PAIR_PROPS.paddingV],
              v,
              paddingLinked,
            )
          }
          onV={(v) =>
            onPairSide(
              PAIR_PROPS.paddingV,
              [...PAIR_PROPS.paddingH, ...PAIR_PROPS.paddingV],
              v,
              paddingLinked,
            )
          }
        />

        <PairBlock
          title={t("browser.design.margin")}
          linked={marginLinked}
          onToggleLink={() => setMarginLinked((prev) => !prev)}
          linkTitle={marginLinked ? t("browser.design.unlink") : t("browser.design.link")}
          canEdit={canEdit}
          hValue={pairDisplay(PAIR_PROPS.marginH)}
          vValue={pairDisplay(PAIR_PROPS.marginV)}
          hAdjusted={isPairAdjusted(PAIR_PROPS.marginH)}
          vAdjusted={isPairAdjusted(PAIR_PROPS.marginV)}
          onH={(v) =>
            onPairSide(
              PAIR_PROPS.marginH,
              [...PAIR_PROPS.marginH, ...PAIR_PROPS.marginV],
              v,
              marginLinked,
            )
          }
          onV={(v) =>
            onPairSide(
              PAIR_PROPS.marginV,
              [...PAIR_PROPS.marginH, ...PAIR_PROPS.marginV],
              v,
              marginLinked,
            )
          }
        />

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={borderBox}
            disabled={!canEdit}
            onChange={(event) =>
              setOne("box-sizing", event.target.checked ? "border-box" : "content-box")
            }
          />
          <span>{t("browser.design.borderBox")}</span>
        </label>
      </DesignSection>

      {/* 外观：透明|圆角 一行 */}
      <DesignSection
        title={t("browser.design.appearance")}
        actions={
          <>
            <button
              type="button"
              className={[styles.iconBtn, styles.iconBtnBordered].join(" ")}
              title={t("browser.design.visibility")}
              disabled={!canEdit}
              onClick={() =>
                setOne("visibility", val("visibility") === "hidden" ? "visible" : "hidden")
              }
            >
              <Eye size={14} weight="regular" />
            </button>
            <button
              type="button"
              className={[styles.iconBtn, styles.iconBtnBordered].join(" ")}
              title={t("browser.design.drop")}
              disabled={!canEdit}
              onClick={() => setOne("filter", "saturate(1.4)")}
            >
              <Drop size={14} weight="regular" />
            </button>
          </>
        }
      >
        <FieldPair>
          <UnitField
            label={t("browser.design.opacityShort")}
            value={opacityDisplay}
            unit="%"
            placeholder={FIELD_OPACITY.placeholder}
            disabled={!canEdit}
            adjusted={isAdjusted(FIELD_OPACITY.prop)}
            onChange={(v) => {
              const css = opacityToCss(v);
              if (css) setOne(FIELD_OPACITY.prop, css);
            }}
          />
          <UnitField
            label={t("browser.design.radiusShort")}
            value={radiusDisplay}
            unit="px"
            placeholder={FIELD_RADIUS.placeholder}
            disabled={!canEdit}
            adjusted={isAdjusted(FIELD_RADIUS.prop)}
            onChange={(v) => setLengthField(FIELD_RADIUS.prop, v, "px")}
          />
        </FieldPair>
      </DesignSection>

      {/* 文本：字体一行 · Weight|Size 一行 · Color 一行 · LH|LS 一行 · 对齐一行 */}
      <DesignSection title={t("browser.design.text")}>
        <DesignField label={t("browser.design.font")} autoLabel>
          <DesignSelect
            value={fontValue}
            options={FONT_OPTIONS.map((f) => f.replace(/^["']|["']$/g, ""))}
            disabled={!canEdit}
            onChange={(v) => setOne(FIELD_FONT.prop, v.includes(" ") ? `"${v}"` : v)}
          />
        </DesignField>

        <FieldPair>
          <DesignSelect
            value={val(FIELD_WEIGHT.prop)}
            options={FIELD_WEIGHT.options ?? []}
            placeholder="400"
            disabled={!canEdit}
            onChange={(v) => setOne(FIELD_WEIGHT.prop, v)}
          />
          <UnitField
            label={t("browser.design.size")}
            value={lengthDisplay(FIELD_SIZE.prop)}
            unit="px"
            placeholder={FIELD_SIZE.placeholder}
            disabled={!canEdit}
            adjusted={isAdjusted(FIELD_SIZE.prop)}
            onChange={(v) => setLengthField(FIELD_SIZE.prop, v, "px")}
          />
        </FieldPair>

        <DenseRow label={t("browser.design.color")}>
          <div className={styles.colorShell}>
            <ColorInput
              value={val(FIELD_COLOR.prop)}
              disabled={!canEdit}
              onChange={(v) => setOne(FIELD_COLOR.prop, v)}
            />
          </div>
        </DenseRow>

        <FieldPair>
          <UnitField
            label={t("browser.design.lineHeightShort")}
            value={numberDisplay(FIELD_LINE_HEIGHT.prop)}
            unit="px"
            placeholder={FIELD_LINE_HEIGHT.placeholder}
            disabled={!canEdit}
            adjusted={isAdjusted(FIELD_LINE_HEIGHT.prop)}
            onChange={(v) => setLengthField(FIELD_LINE_HEIGHT.prop, v, "px")}
          />
          <UnitField
            label={t("browser.design.letterSpacingShort")}
            value={numberDisplay(FIELD_LETTER_SPACING.prop)}
            unit="px"
            placeholder={FIELD_LETTER_SPACING.placeholder}
            disabled={!canEdit}
            adjusted={isAdjusted(FIELD_LETTER_SPACING.prop)}
            onChange={(v) => setLengthField(FIELD_LETTER_SPACING.prop, v, "px")}
          />
        </FieldPair>

        <DenseRow label={t("browser.design.alignShort")}>
          <SegmentButtons
            ariaLabel={t("browser.design.align")}
            value={align}
            onChange={onAlign}
            disabled={!canEdit}
            options={[
              {
                value: "left",
                title: t("browser.design.align.left"),
                icon: <TextAlignLeft size={15} weight="regular" />,
              },
              {
                value: "center",
                title: t("browser.design.align.center"),
                icon: <TextAlignCenter size={15} weight="regular" />,
              },
              {
                value: "right",
                title: t("browser.design.align.right"),
                icon: <TextAlignRight size={15} weight="regular" />,
              },
              {
                value: "justify",
                title: t("browser.design.align.justify"),
                icon: <TextAlignJustify size={15} weight="regular" />,
              },
            ]}
          />
        </DenseRow>
      </DesignSection>

      {/* 背景：色块|透明度|删除 一行 */}
      <DesignSection
        title={t("browser.design.background")}
        actions={
          <>
            <button
              type="button"
              className={[styles.iconBtn, styles.iconBtnBordered].join(" ")}
              title={t("browser.design.pickColor")}
              disabled={!canEdit}
            >
              <Palette size={14} weight="regular" />
            </button>
            <button
              type="button"
              className={[styles.iconBtn, styles.iconBtnBordered].join(" ")}
              title={t("browser.design.add")}
              disabled={!canEdit}
              onClick={() => setOne(FIELD_BG_COLOR.prop, "rgba(0, 0, 0, 0.08)")}
            >
              <Plus size={14} weight="regular" />
            </button>
          </>
        }
      >
        <div className={styles.bgRow}>
          <SwatchOnly
            value={bgColor || "rgba(0, 0, 0, 0)"}
            disabled={!canEdit}
            title={t("browser.design.pickColor")}
            onChange={(v) => setOne(FIELD_BG_COLOR.prop, colorWithAlpha(v, bgAlpha))}
          />
          <UnitField
            value={bgAlpha}
            unit="%"
            placeholder="100"
            disabled={!canEdit}
            adjusted={isAdjusted(FIELD_BG_COLOR.prop)}
            onChange={(v) => {
              if (bgColor) setOne(FIELD_BG_COLOR.prop, colorWithAlpha(bgColor, v));
            }}
          />
          <button
            type="button"
            className={[styles.iconBtn, styles.iconBtnBordered].join(" ")}
            title={t("browser.design.clearBg")}
            disabled={!canEdit}
            onClick={() => edit.removeDeclarations([FIELD_BG_COLOR.prop])}
          >
            <Trash size={14} weight="regular" />
          </button>
        </div>
      </DesignSection>

      {/* 边框：Width|Style 一行 · Color 一行 */}
      <DesignSection
        title={t("browser.design.border")}
        actions={
          <button
            type="button"
            className={[styles.iconBtn, styles.iconBtnBordered].join(" ")}
            title={t("browser.design.add")}
            disabled={!canEdit}
            onClick={() =>
              setMany([
                { name: FIELD_BORDER_WIDTH.prop, value: "1px" },
                { name: FIELD_BORDER_STYLE.prop, value: "solid" },
                {
                  name: FIELD_BORDER_COLOR.prop,
                  value: val(FIELD_BORDER_COLOR.prop) || "currentColor",
                },
              ])
            }
          >
            <Plus size={14} weight="regular" />
          </button>
        }
      >
        <FieldPair>
          <UnitField
            label="W"
            value={lengthDisplay(FIELD_BORDER_WIDTH.prop)}
            unit="px"
            placeholder={FIELD_BORDER_WIDTH.placeholder}
            disabled={!canEdit}
            adjusted={isAdjusted(FIELD_BORDER_WIDTH.prop)}
            onChange={(v) => setLengthField(FIELD_BORDER_WIDTH.prop, v, "px")}
          />
          <DesignSelect
            value={val(FIELD_BORDER_STYLE.prop)}
            options={FIELD_BORDER_STYLE.options ?? []}
            placeholder="solid"
            disabled={!canEdit}
            onChange={(v) => setOne(FIELD_BORDER_STYLE.prop, v)}
          />
        </FieldPair>
        <DenseRow label="C">
          <div className={styles.colorShell}>
            <ColorInput
              value={val(FIELD_BORDER_COLOR.prop)}
              disabled={!canEdit}
              onChange={(v) => setOne(FIELD_BORDER_COLOR.prop, v)}
            />
          </div>
        </DenseRow>
      </DesignSection>

      {/* 阴影：两行长文本并排标签 */}
      <DesignSection
        title={t("browser.design.shadow")}
        actions={
          <button
            type="button"
            className={[styles.iconBtn, styles.iconBtnBordered].join(" ")}
            title={t("browser.design.add")}
            disabled={!canEdit}
            onClick={() => setOne(FIELD_BOX_SHADOW.prop, "0 2px 8px rgba(0, 0, 0, 0.15)")}
          >
            <Plus size={14} weight="regular" />
          </button>
        }
      >
        <DesignField label="Shadow" autoLabel>
          <CommitTextField
            value={val(FIELD_BOX_SHADOW.prop)}
            placeholder={FIELD_BOX_SHADOW.placeholder}
            disabled={!canEdit}
            onChange={(v) => setOne(FIELD_BOX_SHADOW.prop, v)}
            onClear={() => edit.removeDeclarations([FIELD_BOX_SHADOW.prop])}
          />
        </DesignField>
        <DesignField label="Filter" autoLabel>
          <CommitTextField
            value={val(FIELD_FILTER.prop)}
            placeholder={FIELD_FILTER.placeholder}
            disabled={!canEdit}
            onChange={(v) => setOne(FIELD_FILTER.prop, v)}
            onClear={() => edit.removeDeclarations([FIELD_FILTER.prop])}
          />
        </DesignField>
      </DesignSection>
    </div>
  );
}

/** Padding / Margin 单行：短标签 + H/V 图标字段 + 联动。 */
function PairBlock({
  title,
  linked,
  onToggleLink,
  linkTitle,
  canEdit,
  hValue,
  vValue,
  hAdjusted,
  vAdjusted,
  onH,
  onV,
}: {
  title: string;
  linked: boolean;
  onToggleLink: () => void;
  linkTitle: string;
  canEdit: boolean;
  hValue: string;
  vValue: string;
  hAdjusted: boolean;
  vAdjusted: boolean;
  onH: (value: string) => void;
  onV: (value: string) => void;
}) {
  return (
    <DenseRow
      label={title}
      action={
        <button
          type="button"
          className={[styles.iconBtn, styles.iconBtnBordered].join(" ")}
          title={linkTitle}
          aria-pressed={linked}
          onClick={onToggleLink}
        >
          {linked ? <Link size={14} weight="fill" /> : <LinkBreak size={14} weight="regular" />}
        </button>
      }
    >
      <UnitField
        icon={<ArrowsLeftRight size={13} weight="regular" />}
        value={hValue}
        unit="px"
        placeholder="0"
        disabled={!canEdit}
        adjusted={hAdjusted}
        onChange={onH}
      />
      <UnitField
        icon={<ArrowsDownUp size={13} weight="regular" />}
        value={vValue}
        unit="px"
        placeholder="0"
        disabled={!canEdit}
        adjusted={vAdjusted}
        onChange={onV}
      />
    </DenseRow>
  );
}
