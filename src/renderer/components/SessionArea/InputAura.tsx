import { memo, useEffect, useRef } from "react";
import type { InputEffectEngine } from "../../../shared/inputEffect";
import { GLIDE_MOTION } from "../../utils/motionTokens";
import styles from "./InputAura.module.css";
import type { InputAuraPalette } from "./inputAuraRenderer";

interface InputAuraProps {
  effect: InputEffectEngine;
}

/** 输入卡与设置预览共用的背景层；不可见、减少动效或卸载时停止绘制。 */
export const InputAura = memo(function InputAura({ effect }: InputAuraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    void import("./inputAuraRenderer").then(({ createInputAuraRenderer }) => {
      if (disposed) return;
      const palette = (): InputAuraPalette => {
        const style = getComputedStyle(canvas);
        const color = (token: string) => style.getPropertyValue(token).trim();
        return {
          spark: color("--color-spark"),
          gold: color("--input-aura-gold"),
          meteor: color("--input-aura-star-1"),
          stars: Array.from({ length: 6 }, (_, index) => color(`--input-aura-star-${index + 1}`)),
        };
      };
      const engine = createInputAuraRenderer(ctx, effect, palette());
      const reduced = matchMedia("(prefers-reduced-motion: reduce)");
      let width = 0,
        height = 0,
        dpr = 0,
        raf = 0,
        last = 0,
        lastPaint = 0,
        clock = 0;
      let visible = false;
      let pendingCaret: HTMLElement | null = null;
      const tick = (now: number): void => {
        raf = requestAnimationFrame(tick);
        if (now - lastPaint < 1000 / GLIDE_MOTION.fps - 0.5) return;
        lastPaint = now;
        if (pendingCaret) {
          const selection = window.getSelection();
          if (selection?.rangeCount && pendingCaret.contains(selection.anchorNode)) {
            const range = selection.getRangeAt(0).cloneRange();
            range.collapse(true);
            const rect = range.getClientRects()[0];
            if (rect) engine.setCaret(rect.left - canvas.getBoundingClientRect().left);
          }
          pendingCaret = null;
        }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        clock += dt * 1000;
        engine.render(clock, dt);
      };
      const sync = (): void => {
        cancelAnimationFrame(raf);
        raf = 0;
        if (reduced.matches || !visible || document.hidden || width <= 0 || height <= 0) {
          pendingCaret = null;
          ctx.clearRect(0, 0, width, height);
          return;
        }
        last = performance.now();
        lastPaint = last;
        raf = requestAnimationFrame(tick);
      };
      const resize = (): void => {
        const rect = canvas.getBoundingClientRect();
        const nextDpr = Math.min(2, window.devicePixelRatio || 1);
        if (rect.width === width && rect.height === height && dpr === nextDpr) return;
        width = rect.width;
        height = rect.height;
        dpr = nextDpr;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        engine.resize(width, height);
        sync();
      };
      const input = (event: Event): void => {
        // 只认编辑器的真实输入，设置控件、光标移动与程序化草稿水合不注入能量。
        const target = event.target;
        if (
          !(target instanceof HTMLElement) ||
          !target.isContentEditable ||
          reduced.matches ||
          !visible ||
          document.hidden
        )
          return;
        // 只有极光使用光标位置；合并到绘制帧读取，输入事件本身不强制同步布局。
        if (effect === "aurora") pendingCaret = target;
        engine.input();
      };
      const root = document.documentElement;
      const themeKey = () =>
        `${root.dataset.theme}|${root.style.getPropertyValue("--color-accent")}`;
      let lastThemeKey = themeKey();
      const themeObserver = new MutationObserver(() => {
        const key = themeKey();
        if (key === lastThemeKey) return;
        lastThemeKey = key;
        engine.setPalette(palette());
      });
      themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme", "style"] });
      const sizeObserver = new ResizeObserver(resize);
      const intersection = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
        sync();
      });
      resize();
      sizeObserver.observe(canvas);
      intersection.observe(canvas);
      host.addEventListener("input", input, true);
      reduced.addEventListener("change", sync);
      document.addEventListener("visibilitychange", sync);
      window.addEventListener("resize", resize);
      destroy = () => {
        cancelAnimationFrame(raf);
        sizeObserver.disconnect();
        intersection.disconnect();
        themeObserver.disconnect();
        host.removeEventListener("input", input, true);
        reduced.removeEventListener("change", sync);
        document.removeEventListener("visibilitychange", sync);
        window.removeEventListener("resize", resize);
        ctx.clearRect(0, 0, width, height);
      };
    });
    return () => {
      disposed = true;
      destroy?.();
    };
  }, [effect]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.canvas} ${effect === "nebula" ? styles.nebula : ""}`}
    />
  );
});
