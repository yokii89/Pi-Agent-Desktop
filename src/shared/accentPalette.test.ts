import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS } from "./accentColor";
import { accentContrastRatio, createAccentPalette } from "./accentPalette";

const themes = {
  dark: ["#111113", "#18181b", "#202024", "#0d0d0f"],
  light: ["#f5f5f7", "#ffffff", "#ececef"],
};

function composite(foreground: string, background: string, opacity: number): string {
  return `#${[1, 3, 5]
    .map((offset) => {
      const fg = Number.parseInt(foreground.slice(offset, offset + 2), 16);
      const bg = Number.parseInt(background.slice(offset, offset + 2), 16);
      return Math.round(fg * opacity + bg * (1 - opacity))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

describe("accent palette", () => {
  it("uses relative luminance rather than average RGB brightness", () => {
    expect(accentContrastRatio("#000000", "#ffffff")).toBe(21);
    expect(accentContrastRatio("#777777", "#ffffff")).toBeCloseTo(4.478, 3);
    expect(accentContrastRatio("#008000", "#000000")).toBeGreaterThan(
      accentContrastRatio("#000080", "#000000"),
    );
  });

  for (const [theme, surfaces] of Object.entries(themes)) {
    it(`${theme}: keeps text, hover text and focus lines readable for presets and extreme system colors`, () => {
      const colors = new Set<string>(ACCENT_PRESETS.map(({ value }) => value));
      for (const r of [0, 64, 128, 192, 255]) {
        for (const g of [0, 64, 128, 192, 255]) {
          for (const b of [0, 64, 128, 192, 255]) {
            colors.add(
              `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`,
            );
          }
        }
      }
      for (const color of colors) {
        const palette = createAccentPalette(color, surfaces);
        for (const surface of surfaces) {
          for (const background of [
            surface,
            composite(color, surface, 0.16),
            composite(palette.foreground, surface, 0.1),
          ]) {
            expect(
              accentContrastRatio(palette.foreground, background),
              `${color} on ${background}`,
            ).toBeGreaterThanOrEqual(4.5);
            expect(
              accentContrastRatio(palette.foregroundHover, background),
              `${color} hover on ${background}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
          expect(
            accentContrastRatio(palette.border, surface),
            `${color} border on ${surface}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }

  it("retains colors that already have enough contrast", () => {
    expect(createAccentPalette("#b4d6ff", themes.dark).foreground).toBe("#b4d6ff");
    expect(createAccentPalette("#123456", themes.light).foreground).toBe("#123456");
  });
});
