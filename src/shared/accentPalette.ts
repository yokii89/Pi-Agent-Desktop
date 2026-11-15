type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  return [channel(1), channel(3), channel(5)];
}

function luminance(color: Rgb): number {
  const [r, g, b] = color.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mix(color: Rgb, target: Rgb, amount: number): Rgb {
  const channel = (index: number) =>
    Math.round(color[index] + (target[index] - color[index]) * amount);
  return [channel(0), channel(1), channel(2)];
}

function hex(color: Rgb): string {
  return `#${color.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** 两个不透明 #RRGGBB 色值的相对亮度对比度。 */
export function accentContrastRatio(first: string, second: string): number {
  return contrast(rgb(first), rgb(second));
}

/** 与原始填充色分离的可读文字、悬停文字及焦点细线配色。 */
export interface AccentPalette {
  foreground: string;
  foregroundHover: string;
  border: string;
}

/**
 * 从原始强调色派生正文与细线颜色；只在对比不足时向黑/白调整，不改实心填充色。
 * backgrounds 是同一主题的不透明表面；正文同时覆盖原色软底与选中项的浅染色底。
 */
export function createAccentPalette(color: string, backgrounds: readonly string[]): AccentPalette {
  const source = rgb(color);
  const surfaces = backgrounds.map(rgb);
  const black: Rgb = [0, 0, 0];
  const white: Rgb = [255, 255, 255];
  const minimumContrast = (candidate: Rgb, text: boolean): number =>
    Math.min(
      ...surfaces.flatMap((surface) => [
        contrast(candidate, surface),
        ...(text
          ? [
              contrast(candidate, mix(surface, source, 0.16)),
              contrast(candidate, mix(surface, candidate, 0.1)),
            ]
          : []),
      ]),
    );
  const target = minimumContrast(white, true) >= minimumContrast(black, true) ? white : black;
  const adjust = (ratio: number, text: boolean): Rgb => {
    if (minimumContrast(source, text) >= ratio) return source;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 20; iteration++) {
      const middle = (low + high) / 2;
      if (minimumContrast(mix(source, target, middle), text) >= ratio) high = middle;
      else low = middle;
    }
    return mix(source, target, high);
  };
  const foreground = adjust(4.5, true);
  return {
    foreground: hex(foreground),
    foregroundHover: hex(mix(foreground, target, 0.12)),
    border: hex(adjust(3, false)),
  };
}
