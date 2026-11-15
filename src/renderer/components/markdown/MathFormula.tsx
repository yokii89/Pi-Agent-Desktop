import { memo, useEffect, useState } from "react";
import styles from "./markdown.module.css";

type MathRenderer = typeof import("katex")["default"];
let renderer: Promise<MathRenderer> | undefined;

function loadMath(): Promise<MathRenderer> {
  renderer ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    .then(([module]) => module.default)
    .catch((error: unknown) => {
      renderer = undefined;
      throw error;
    });
  return renderer;
}

/** Render only through KaTeX's untrusted mode; malformed or oversized input remains readable source. */
export const MathFormula = memo(function MathFormula({
  source,
  display = false,
}: {
  source: string;
  display?: boolean;
}) {
  const [engine, setEngine] = useState<MathRenderer | null>(null);
  useEffect(() => {
    let active = true;
    void loadMath()
      .then((value) => {
        if (active) setEngine(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  let html: string | null = null;
  if (engine && source.length <= 8_000) {
    try {
      html = engine.renderToString(source, {
        displayMode: display,
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1_000,
        maxSize: 20,
        output: "htmlAndMathml",
      });
    } catch {
      // Incomplete streamed expressions and unsupported commands retain their source.
    }
  }
  const Tag = display ? "div" : "span";
  return html === null ? (
    <Tag className={display ? styles.mathDisplay : styles.mathInline} data-selectable-text>
      {source}
    </Tag>
  ) : (
    <Tag
      className={display ? styles.mathDisplay : styles.mathInline}
      data-selectable-text
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is generated exclusively by KaTeX with trust disabled.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
