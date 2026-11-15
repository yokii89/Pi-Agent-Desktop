export interface ThinkingMatrixPalette {
  surface: string;
  muted: string;
  accent: string;
  accentForeground: string;
  spark: string;
  strong: string;
}

interface ThinkingMatrixCell {
  threshold: number;
  phase: number;
  frequency: number;
  colorBias: number;
  verticalBar: boolean;
}

interface ThinkingMatrixRay {
  angle: number;
  dots: number;
  speed: number;
  phase: number;
  color: keyof ThinkingMatrixPalette;
}

/** Canvas renderer lifecycle exposed to the React slider. */
export interface ThinkingMatrixRenderer {
  resize: () => void;
  refreshPalette: () => void;
  render: (time: number, value: number) => void;
}

const MATRIX_ROWS = 3;
const RAY_COUNT = 22;
const RAY_SIZE = 120;
const COMET_WIDTH = 56;
const COMET_HEIGHT = 48;
const COMET_ART_WIDTH = 76;
const COMET_ART_HEIGHT = 64;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const seededRandom = (seed: number): number => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function readToken(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || "currentColor";
}

function readPalette(element: Element): ThinkingMatrixPalette {
  return {
    surface: readToken(element, "--color-bg"),
    muted: readToken(element, "--color-text-muted"),
    accent: readToken(element, "--color-accent"),
    accentForeground: readToken(element, "--color-accent-fg"),
    spark: readToken(element, "--color-spark"),
    strong: readToken(element, "--color-text-strong"),
  };
}

function colorMix(first: string, second: string, firstWeight: number): string {
  return `color-mix(in oklab, ${first} ${firstWeight}%, ${second})`;
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
  context.fill();
}

function buildCells(width: number, height: number): ThinkingMatrixCell[][] {
  const gap = 2.2;
  const cellHeight = (height - gap * (MATRIX_ROWS - 1)) / MATRIX_ROWS;
  const columns = Math.max(24, Math.floor((width + gap) / (cellHeight + gap)));
  const cells: ThinkingMatrixCell[][] = [];

  for (let column = 0; column < columns; column += 1) {
    const columnCells: ThinkingMatrixCell[] = [];
    for (let row = 0; row < MATRIX_ROWS; row += 1) {
      const seed = column * 101 + row * 37 + 13;
      columnCells.push({
        threshold: seededRandom(seed),
        phase: seededRandom(seed + 1) * Math.PI * 2,
        frequency: 1.2 + seededRandom(seed + 2) * 2.5,
        colorBias: seededRandom(seed + 3),
        verticalBar: column === Math.floor(columns * 0.22) && row === 1,
      });
    }
    cells.push(columnCells);
  }

  return cells;
}

function buildRays(): ThinkingMatrixRay[] {
  const rays: ThinkingMatrixRay[] = [];
  const colors: Array<keyof ThinkingMatrixPalette> = [
    "accentForeground",
    "spark",
    "accent",
    "strong",
  ];

  for (let index = 0; index < RAY_COUNT; index += 1) {
    rays.push({
      angle: (index / RAY_COUNT) * Math.PI * 2 + (seededRandom(index * 31) - 0.5) * 0.08,
      dots: 4 + Math.floor(seededRandom(index * 17) * 4),
      speed: 0.75 + seededRandom(index * 43) * 0.95,
      phase: seededRandom(index * 89) * Math.PI * 2,
      color: colors[Math.min(colors.length - 1, Math.floor(seededRandom(index * 53) * 4))],
    });
  }

  return rays;
}

function drawTrack(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  cells: ThinkingMatrixCell[][],
  time: number,
  value: number,
  palette: ThinkingMatrixPalette,
): void {
  context.clearRect(0, 0, width, height);

  const activeWidth = value * width;
  if (activeWidth > 1) {
    const background = context.createLinearGradient(0, 0, activeWidth, 0);
    background.addColorStop(0, colorMix(palette.surface, palette.accent, 90));
    background.addColorStop(0.58, colorMix(palette.accent, palette.surface, 76));
    background.addColorStop(1, colorMix(palette.spark, palette.surface, 62));
    context.fillStyle = background;
    context.globalAlpha = 0.6;
    context.fillRect(0, 0, activeWidth, height);
  }

  const rows = MATRIX_ROWS;
  const gap = 2.2;
  const cellHeight = (height - gap * (rows - 1)) / rows;
  const columns = cells.length;
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const radius = Math.max(1.5, Math.min(cellWidth, cellHeight) * 0.26);

  for (let column = 0; column < columns; column += 1) {
    const columnNorm = column / Math.max(1, columns - 1);
    const x = column * (cellWidth + gap);
    for (let row = 0; row < rows; row += 1) {
      const cell = cells[column][row];
      const y = row * (cellHeight + gap);
      const distanceFromHandle = columnNorm - value;

      if (distanceFromHandle > 0.015) {
        context.fillStyle = palette.muted;
        context.globalAlpha = 0.12;
        fillRoundedRect(context, x, y, cellWidth, cellHeight, radius);
        continue;
      }

      const relativePosition = value > 0.02 ? clamp(columnNorm / value, 0, 1) : 0;
      const intensity = columnNorm ** 1.35 * 0.65 + relativePosition ** 1.6 * 0.35;
      const flow = Math.sin(time * cell.frequency - column * 0.38 + cell.phase);
      const shimmer = (flow + 1) * 0.5;

      if (cell.verticalBar && columnNorm < value - 0.05 && row === 1) {
        context.fillStyle = palette.muted;
        context.globalAlpha = 0.38 + 0.22 * shimmer;
        fillRoundedRect(context, x, y, cellWidth, cellHeight * 2 + gap, radius * 1.2);
        row += 1;
        continue;
      }

      const activeProbability = 0.1 + 0.88 * intensity ** 1.15;
      const dynamicThreshold = (cell.threshold + time * 0.08) % 1;
      const isLit =
        cell.threshold < activeProbability || dynamicThreshold < activeProbability * 0.4;

      if (!isLit) {
        context.fillStyle = palette.surface;
        context.globalAlpha = 0.7;
        fillRoundedRect(context, x, y, cellWidth, cellHeight, radius);
        continue;
      }

      let color = palette.muted;
      let alpha = 0.24 + 0.42 * shimmer * (0.4 + columnNorm);
      if (columnNorm < 0.32) {
        color = cell.colorBias < 0.45 ? palette.muted : palette.accentForeground;
      } else if (columnNorm < 0.68) {
        color =
          cell.colorBias < 0.24
            ? colorMix(palette.accentForeground, palette.accent, 66)
            : cell.colorBias < 0.66
              ? colorMix(palette.accent, palette.spark, 58)
              : palette.spark;
        alpha = 0.35 + 0.55 * shimmer;
      } else {
        color =
          cell.colorBias < 0.2
            ? palette.accentForeground
            : cell.colorBias < 0.52
              ? palette.spark
              : cell.colorBias < 0.8
                ? colorMix(palette.spark, palette.strong, 70)
                : palette.strong;
        alpha = 0.55 + 0.45 * shimmer;
      }

      const proximity = Math.max(0, 1 - Math.abs(columnNorm - value) * 7);
      if (proximity > 0 && value > 0.25) {
        color = colorMix(color, palette.strong, Math.round(proximity * 45 * shimmer));
        alpha = Math.min(1, alpha + proximity * 0.3);
      }

      context.fillStyle = color;
      context.globalAlpha = alpha;
      fillRoundedRect(context, x, y, cellWidth, cellHeight, radius);
    }
  }

  context.globalAlpha = 1;
}

function drawRays(
  context: CanvasRenderingContext2D,
  size: number,
  time: number,
  value: number,
  rays: ThinkingMatrixRay[],
  palette: ThinkingMatrixPalette,
): void {
  context.clearRect(0, 0, size, size);
  const effort = clamp((value - 0.28) / 0.72, 0, 1);
  if (effort <= 0.01) return;

  const centerX = size / 2 + 4;
  const centerY = size / 2;
  const halo = context.createRadialGradient(centerX, centerY, 8, centerX, centerY, size * 0.44);
  halo.addColorStop(0, palette.spark);
  halo.addColorStop(0.48, palette.accent);
  halo.addColorStop(1, "transparent");
  context.fillStyle = halo;
  context.globalAlpha = 0.24 * effort;
  context.beginPath();
  context.arc(centerX, centerY, size * 0.44, 0, Math.PI * 2);
  context.fill();

  const innerRadius = 26;
  const dotSpacing = 5.2;
  for (const ray of rays) {
    const angle = ray.angle + Math.sin(time * 0.4 + ray.phase) * 0.03;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const wavePosition = (time * ray.speed * 2.5 + ray.phase) % (ray.dots + 2);
    for (let dot = 0; dot < ray.dots; dot += 1) {
      if (dot / ray.dots > effort * 1.1) continue;
      const radius = innerRadius + dot * dotSpacing;
      const x = centerX + cos * radius;
      const y = centerY + sin * radius;
      const pulse = Math.max(0, 1 - Math.abs(dot - wavePosition) * 0.55);
      const tipFade = 1 - dot / (ray.dots + 0.5);
      const alpha = Math.min(1, (0.25 + 0.75 * pulse) * tipFade * effort);
      if (alpha < 0.05) continue;

      context.fillStyle = palette[ray.color];
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(x, y, (1.5 + 0.95 * pulse) * Math.min(1.15, effort + 0.3) * 0.55, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.globalAlpha = 1;
}

function drawComet(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  value: number,
  time: number,
  palette: ThinkingMatrixPalette,
): void {
  context.clearRect(0, 0, width, height);
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate((-4 + value * 4) * (Math.PI / 180));
  context.scale(width / COMET_ART_WIDTH, height / COMET_ART_HEIGHT);
  context.scale(0.92 + value * 0.14, 0.92 + value * 0.14);

  context.shadowColor = palette.spark;
  context.shadowBlur = 7 + value * 7;
  const body = context.createLinearGradient(-31, 0, 27, 0);
  body.addColorStop(0, palette.accentForeground);
  body.addColorStop(0.36, palette.accent);
  body.addColorStop(0.7, palette.spark);
  body.addColorStop(1, palette.strong);

  context.fillStyle = colorMix(palette.accent, palette.surface, 30);
  context.beginPath();
  context.moveTo(28, -1);
  context.bezierCurveTo(28, -14, 16, -21, 4, -17);
  context.bezierCurveTo(-9, -14, -19, -8, -31, -7);
  context.bezierCurveTo(-23, -3, -21, 0, -33, 3);
  context.bezierCurveTo(-20, 6, -16, 8, -26, 14);
  context.bezierCurveTo(-11, 17, 1, 15, 10, 12);
  context.bezierCurveTo(21, 9, 28, 6, 28, -1);
  context.closePath();
  context.fill();

  context.shadowBlur = 4;
  context.fillStyle = body;
  context.beginPath();
  context.moveTo(26, -1);
  context.bezierCurveTo(26, -11, 15, -17, 4, -14);
  context.bezierCurveTo(-9, -11, -18, -6, -28, -5);
  context.bezierCurveTo(-18, -2, -14, 0, -27, 3);
  context.bezierCurveTo(-16, 6, -11, 7, -21, 11);
  context.bezierCurveTo(-8, 13, 1, 12, 10, 9);
  context.bezierCurveTo(20, 7, 26, 5, 26, -1);
  context.closePath();
  context.fill();

  context.shadowBlur = 0;
  context.strokeStyle = palette.accent;
  context.globalAlpha = 0.72;
  context.lineWidth = 2.4;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-18, -5);
  context.bezierCurveTo(-7, -6, 2, -11, 11, -12);
  context.stroke();
  context.beginPath();
  context.moveTo(-13, 3);
  context.bezierCurveTo(-4, 2, 4, 4, 10, 7);
  context.stroke();

  const core = context.createRadialGradient(14, -1, 1, 14, -1, 12);
  core.addColorStop(0, palette.strong);
  core.addColorStop(0.45, palette.strong);
  core.addColorStop(0.75, palette.spark);
  core.addColorStop(1, palette.accent);
  context.globalAlpha = 1;
  context.fillStyle = core;
  context.beginPath();
  context.arc(14, -1, 10.5, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = palette.strong;
  context.beginPath();
  context.moveTo(14, -10);
  context.lineTo(16, -3);
  context.lineTo(23, -1);
  context.lineTo(16, 1);
  context.lineTo(14, 9);
  context.lineTo(12, 1);
  context.lineTo(5, -1);
  context.lineTo(12, -3);
  context.closePath();
  context.fill();

  context.globalAlpha = 0.58 + 0.42 * (0.5 + 0.5 * Math.sin(time * 4.4));
  context.fillStyle = palette.strong;
  for (const sparkle of [
    [-1, -8, 1.2],
    [0, 6, 1.1],
    [-9, 5, 0.9],
    [-12, -3, 0.8],
  ]) {
    context.beginPath();
    context.arc(sparkle[0], sparkle[1], sparkle[2], 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
  context.globalAlpha = 1;
}

/** Creates the themed pixel-track, comet, and particle-ray canvas renderer. */
export function createThinkingMatrixRenderer(
  trackCanvas: HTMLCanvasElement,
  raysCanvas: HTMLCanvasElement,
  cometCanvas: HTMLCanvasElement,
): ThinkingMatrixRenderer | null {
  const trackContext = trackCanvas.getContext("2d");
  const raysContext = raysCanvas.getContext("2d");
  const cometContext = cometCanvas.getContext("2d");
  if (!trackContext || !raysContext || !cometContext) return null;

  let width = 0;
  let height = 0;
  let raysSize = RAY_SIZE;
  let cometWidth = COMET_WIDTH;
  let cometHeight = COMET_HEIGHT;
  let cells: ThinkingMatrixCell[][] = [];
  const rays = buildRays();
  let palette = readPalette(trackCanvas);

  const resizeCanvas = (canvas: HTMLCanvasElement, nextWidth: number, nextHeight: number): void => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(nextWidth * dpr));
    canvas.height = Math.max(1, Math.round(nextHeight * dpr));
    const context =
      canvas === trackCanvas ? trackContext : canvas === raysCanvas ? raysContext : cometContext;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const resize = (): void => {
    const trackRect = trackCanvas.getBoundingClientRect();
    const raysRect = raysCanvas.getBoundingClientRect();
    const cometRect = cometCanvas.getBoundingClientRect();
    width = trackRect.width;
    height = trackRect.height;
    raysSize = raysRect.width || RAY_SIZE;
    cometWidth = cometRect.width || COMET_WIDTH;
    cometHeight = cometRect.height || COMET_HEIGHT;
    resizeCanvas(trackCanvas, width, height);
    resizeCanvas(raysCanvas, raysSize, raysSize);
    resizeCanvas(cometCanvas, cometWidth, cometHeight);
    cells = buildCells(width, height);
  };

  return {
    resize,
    refreshPalette: () => {
      palette = readPalette(trackCanvas);
    },
    render: (time, value) => {
      if (width <= 0 || height <= 0) return;
      const clampedValue = clamp(value, 0, 1);
      drawTrack(trackContext, width, height, cells, time, clampedValue, palette);
      drawRays(raysContext, raysSize, time, clampedValue, rays, palette);
      drawComet(cometContext, cometWidth, cometHeight, clampedValue, time, palette);
    },
  };
}
