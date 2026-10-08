import { describe, expect, it } from "vitest";
import type { StylePatchDeclaration } from "../../shared/ipc";
import { formatStylePatchCss } from "./inspectorEdit";

function decl(
  partial: Partial<StylePatchDeclaration> & { name: string; value: string },
): StylePatchDeclaration {
  return {
    important: false,
    enabled: true,
    ...partial,
  };
}

describe("formatStylePatchCss", () => {
  it("只导出已启用声明，并带上站点与 selector 注释", () => {
    const css = formatStylePatchCss(
      [
        {
          selector: "button.btn",
          declarations: [
            decl({ name: "border-radius", value: "8px" }),
            decl({ name: "color", value: "red", enabled: false }),
            decl({ name: "padding", value: "8px 16px", important: true }),
          ],
        },
      ],
      "localhost:5173",
    );
    expect(css).toContain("PiDesk 临时调整 · localhost:5173 · button.btn");
    expect(css).toContain("border-radius: 8px;");
    expect(css).toContain("padding: 8px 16px !important;");
    expect(css).not.toContain("color: red");
  });

  it("全部未启用时不出块", () => {
    const css = formatStylePatchCss(
      [{ selector: "div", declarations: [decl({ name: "color", value: "red", enabled: false })] }],
      "",
    );
    expect(css).toBe("");
  });

  it("自定义属性大小写原样保留", () => {
    const css = formatStylePatchCss(
      [
        {
          selector: "div",
          declarations: [decl({ name: "--BrandColor", value: "#4a8cff" })],
        },
      ],
      "x",
    );
    expect(css).toContain("--BrandColor: #4a8cff;");
  });
});
