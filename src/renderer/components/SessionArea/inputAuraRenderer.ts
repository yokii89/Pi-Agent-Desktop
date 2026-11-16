import type { InputEffectEngine } from "../../../shared/inputEffect";
import { INPUT_AURA_MOTION } from "../../utils/motionTokens";

interface Particle {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  phase: number;
  life: number;
  span: number;
}
interface Rune {
  life: number;
  span: number;
  rot: number;
}
interface Star {
  x: number;
  y: number;
  layer: number;
  r: number;
  alpha: number;
  phase: number;
  twinkleSpeed: number;
  tint: string;
}
interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  life: number;
  span: number;
}
export interface InputAuraPalette {
  spark: string;
  gold: string;
  meteor: string;
  stars: string[];
}

/** 从用户确认的特效合集移植的四种 Canvas 引擎；不访问 DOM，不另开时间轴。 */
export function createInputAuraRenderer(
  ctx: CanvasRenderingContext2D,
  effect: InputEffectEngine,
  initialPalette: InputAuraPalette,
) {
  let palette = initialPalette;
  let spark = palette.spark,
    goldTone = palette.gold;
  let width = 0,
    height = 0,
    due = 0,
    speed = 1,
    pulse = 0,
    energy = 0,
    strokes = 0;
  let runeDue = 0,
    arrayPhase = 0,
    sweepPhase = 0,
    arrayIn = 0;
  const array = { x: 0, y: 0, r: 60 };
  const caret = { x: 120, y: 48 };
  const parts: Particle[] = [];
  const runes: Rune[] = [];
  const parallaxStars: Star[] = [];
  const meteors: Meteor[] = [];
  function spawnEmber(burst: boolean): void {
    parts.push({
      x: Math.random() * width,
      y: burst ? height * (0.2 + Math.random() * 0.8) : height + 3,
      r: 0.9 + Math.random() * 1.1,
      vy: -(7 + Math.random() * 9),
      sway: (Math.random() - 0.5) * 10,
      phase: Math.random() * Math.PI * 2,
      life: burst ? Math.random() * 1.2 : 0,
      span: 2.4 + Math.random() * 2.4,
    });
  }

  function renderEmber(now: number, dt: number): void {
    due += dt;
    while (due > 0.14) {
      due -= 0.14;
      if (parts.length < 30) spawnEmber(false);
    }
    ctx.fillStyle = spark;
    ctx.shadowColor = spark;
    ctx.shadowBlur = 6 + energy * 10 + pulse * 6;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life > p.span) {
        parts.splice(i, 1);
        continue;
      }
      const k = p.life / p.span;
      const twinkle = 0.7 + 0.3 * Math.sin((now / 160) * (1 + energy) + p.phase);
      p.y += p.vy * dt * speed;
      if (p.y < -4) {
        p.y = height + 3;
        p.x = Math.random() * width;
      }
      const edge = Math.min(1, Math.max(0, p.y / 14), Math.max(0, (height - p.y) / 14));
      ctx.globalAlpha = Math.min(1, Math.sin(k * Math.PI) * (0.9 + energy * 0.25) * twinkle) * edge;
      ctx.beginPath();
      ctx.arc(
        p.x + Math.sin((now / 900) * (1 + energy * 0.8) + p.phase) * p.sway,
        p.y,
        p.r * twinkle * (1 + energy * 0.35),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // ==================== 2. 极光谐振 (Aurora) ====================
  function renderAurora(now: number): void {
    ctx.strokeStyle = spark;
    ctx.fillStyle = spark;
    ctx.shadowColor = spark;
    ctx.shadowBlur = 12 + energy * 14;

    const bands = 3;
    const baseAmp = 6 + energy * 22 + pulse * 8;
    const freq = 0.012 + energy * 0.008;
    // 浪高上限压到原峰值的 1/3：只缩放振幅，频率、波带位置与亮度均不变
    const ampScale = 1 / 3;

    for (let b = 0; b < bands; b++) {
      const phase = now / (700 - b * 110) + b * 1.4;
      const yBase = height - 12 - b * 8;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 8) {
        // 越靠近光标位置振幅越强
        const distToCaret = Math.abs(x - caret.x);
        const localBoost = Math.exp(-(distToCaret * distToCaret) / 18000) * (energy * 16);
        const y =
          yBase -
          Math.sin(x * freq + phase) * (baseAmp + localBoost) * ampScale -
          Math.cos(x * freq * 2.1 - phase * 1.3) * (baseAmp * 0.4) * ampScale;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.globalAlpha = (0.14 - b * 0.03) * (1 + energy * 0.5);
      ctx.fill();

      ctx.globalAlpha = (0.45 - b * 0.1) * (1 + energy * 0.3);
      ctx.lineWidth = 1.5 - b * 0.3;
      ctx.stroke();
    }
  }

  // ==================== 3. 希卡法阵 · 三角力量 (Triforce) ====================
  const SEG = (Math.PI * 2) / 24;

  function layoutArray(): void {
    array.x = width * 0.5;
    array.y = height * 0.52;
    array.r = Math.max(30, Math.min(height * 0.44, 96));
  }

  // 希卡光尘：细菱形微粒
  function spawnSheikahMote(seed: boolean): void {
    parts.push({
      x: Math.random() * width,
      y: seed ? Math.random() * height : height + 4,
      r: 1.1 + Math.random() * 1.2,
      vy: -(5 + Math.random() * 8),
      sway: 3 + Math.random() * 9,
      phase: Math.random() * Math.PI * 2,
      life: seed ? Math.random() * 2 : 0,
      span: 2.4 + Math.random() * 2.4,
    });
  }

  function triggerArrayPulse(): void {
    runes.push({ life: 0, span: 1.9, rot: Math.random() * Math.PI });
    if (runes.length > 5) runes.shift();
  }

  // 只建路径：以 (cx,cy) 为心、外接半径 r、rot=0 时顶点朝上
  function trianglePath(cx: number, cy: number, r: number, rot: number): void {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = rot + (i * Math.PI * 2) / 3 - Math.PI / 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function diamondPath(cx: number, cy: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  }

  function renderTriforce(now: number, dt: number): void {
    const cyan = spark;
    const gold = goldTone;
    const cx = array.x,
      cy = array.y;
    const spin = 1 + energy * 2.2;
    arrayPhase += dt * 0.16 * spin;
    sweepPhase += dt * 0.5 * spin;
    const R = array.r * (1 + energy * 0.07);

    arrayIn = Math.min(1, arrayIn + dt / 0.6);
    const base = arrayIn;

    ctx.strokeStyle = cyan;
    ctx.shadowColor = cyan;
    ctx.lineWidth = 1;

    // ---- 外环：24 段刻度弧（每 3 段加重），外加 4 根正方向长刻度
    ctx.shadowBlur = 5 + energy * 10;
    for (let i = 0; i < 24; i++) {
      const a0 = arrayPhase + i * SEG;
      ctx.globalAlpha = base * ((i % 3 === 0 ? 0.19 : 0.1) + energy * 0.14);
      ctx.beginPath();
      ctx.arc(cx, cy, R, a0, a0 + SEG * 0.46);
      ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const a = arrayPhase + i * (Math.PI / 2);
      ctx.globalAlpha = base * (0.22 + energy * 0.2);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    }

    // ---- 中环：反向旋转的虚环 + 8 颗菱形数据节点
    const R2 = R * 0.74;
    for (let i = 0; i < 12; i++) {
      const a0 = -arrayPhase * 1.5 + i * (Math.PI / 6);
      ctx.globalAlpha = base * (0.07 + energy * 0.09);
      ctx.beginPath();
      ctx.arc(cx, cy, R2, a0, a0 + 0.3);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const a = -arrayPhase * 1.5 + i * (Math.PI / 4) + 0.2;
      ctx.globalAlpha = base * (0.2 + energy * 0.22);
      diamondPath(cx + Math.cos(a) * R2, cy + Math.sin(a) * R2, 2.1 + energy * 1.4);
      ctx.stroke();
    }

    // ---- 扫描亮弧：带拖尾绕外环巡弋
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 10 + energy * 16;
    const sweepPulse = 0.62 + 0.38 * Math.sin(now / 480);
    for (let i = 0; i < 8; i++) {
      const a0 = sweepPhase - 0.85 + i * 0.106;
      ctx.globalAlpha = base * (0.03 + energy * 0.18) * (i / 7) ** 2 * sweepPulse;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.03, a0, a0 + 0.12);
      ctx.stroke();
    }

    // ---- 内环：黄金三角力量（三个小三角拼合，中央倒三角留空）
    const tri = R * 0.48;
    const breathe = base * (0.5 + 0.16 * Math.sin(now / 1000) + energy * 0.3);
    ctx.strokeStyle = gold;
    ctx.fillStyle = gold;
    ctx.shadowColor = gold;
    ctx.shadowBlur = 8 + energy * 16;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * ((Math.PI * 2) / 3);
      // 三个小三角：心在顶点与中心连线的一半处，外接半径为整体的一半 → 严丝合缝拼成大三角
      const sx = cx + Math.cos(a) * (tri / 2);
      const sy = cy + Math.sin(a) * (tri / 2);
      trianglePath(sx, sy, tri / 2, 0);
      ctx.globalAlpha = breathe * 0.24;
      ctx.fill();
      ctx.globalAlpha = breathe * 0.92;
      ctx.stroke();
    }

    // ---- 法阵激活：分段环自中心外扩（节奏浮现，绝不跟随敲击）
    ctx.strokeStyle = cyan;
    ctx.shadowColor = cyan;
    runeDue += dt;
    if (runeDue > 3.4 / (1 + energy * 0.6)) {
      runeDue = 0;
      triggerArrayPulse();
    }
    for (let i = runes.length - 1; i >= 0; i--) {
      const rn = runes[i];
      rn.life += dt;
      if (rn.life >= rn.span) {
        runes.splice(i, 1);
        continue;
      }
      const k = rn.life / rn.span;
      const ease = 1 - (1 - k) ** 3;
      const radius = R * (0.42 + 1.55 * ease);
      const fade = Math.min(1, k / 0.3) * (1 - k);

      ctx.lineWidth = 1;
      ctx.shadowBlur = 7 + energy * 10;
      for (let s = 0; s < 16; s++) {
        const a0 = rn.rot + s * (Math.PI / 8) - sweepPhase * 0.4;
        ctx.globalAlpha = fade * 0.3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, a0, a0 + (Math.PI / 8) * 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = gold;
      ctx.shadowColor = gold;
      ctx.globalAlpha = fade * 0.24;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = cyan;
      ctx.shadowColor = cyan;
    }

    // ---- 希卡光尘：菱形微粒自底升起
    due += dt;
    const interval = 0.22 / (1 + energy * 1.5);
    while (due > interval) {
      due -= interval;
      if (parts.length < 24) spawnSheikahMote(false);
    }
    ctx.fillStyle = cyan;
    ctx.shadowColor = cyan;
    ctx.shadowBlur = 5 + energy * 8;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life > p.span) {
        parts.splice(i, 1);
        continue;
      }
      const k = p.life / p.span;
      p.y += p.vy * dt;
      if (p.y < -6) {
        p.y = height + 4;
        p.x = Math.random() * width;
        p.life = 0;
      }
      const twinkle = 0.6 + 0.4 * Math.sin((now / 240) * (1 + energy) + p.phase);
      ctx.globalAlpha = Math.min(0.85, Math.sin(k * Math.PI) * 0.7 * twinkle);
      diamondPath(p.x + Math.sin(now / 1100 + p.phase) * p.sway, p.y, p.r * twinkle);
      ctx.fill();
    }
    ctx.lineWidth = 1;
  }

  // ==================== 4. 静谧星云与星座 (Nebula) ====================
  function initParallaxStars(): void {
    parallaxStars.length = 0;
    for (let i = 0; i < 130; i++) {
      const layer = Math.random() < 0.68 ? 0 : Math.random() < 0.82 ? 1 : 2; // 0:远尘, 1:中星, 2:亮星
      parallaxStars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        layer,
        r:
          layer === 0
            ? 0.55 + Math.random() * 0.4
            : layer === 1
              ? 0.9 + Math.random() * 0.6
              : 1.5 + Math.random() * 0.9,
        alpha:
          layer === 0
            ? 0.22 + Math.random() * 0.3
            : layer === 1
              ? 0.45 + Math.random() * 0.35
              : 0.75 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.8 + Math.random() * 2.2,
        tint: palette.stars[i % palette.stars.length] ?? spark,
      });
    }
  }

  // 望远镜十字衍射星芒（用于近景亮星）
  function drawCrossStar(x: number, y: number, radius: number, color: string, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = spark;
    ctx.shadowBlur = 8 + energy * 8;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    const spike = radius * (3.8 + energy * 2.2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.75;
    ctx.globalAlpha = alpha * 0.65;
    ctx.beginPath();
    ctx.moveTo(x - spike, y);
    ctx.lineTo(x + spike, y);
    ctx.moveTo(x, y - spike * 0.85);
    ctx.lineTo(x, y + spike * 0.85);
    ctx.stroke();
    ctx.restore();
  }

  function renderNebula(now: number, dt: number): void {
    // 柔和流动的星云团
    for (let i = 0; i < 2; i++) {
      const nx = width * (0.28 + i * 0.44) + Math.sin(now / 4000 + i * 2) * 45;
      const ny = height * (0.55 - i * 0.15) + Math.cos(now / 3200 + i) * 20;
      const r = 160 + i * 40 + energy * 45;
      const g = ctx.createRadialGradient(nx, ny, 4, nx, ny, r);
      g.addColorStop(0, spark);
      g.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.06 + energy * 0.08;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }

    // 三层视差星辰缓慢漂移
    const baseDrift = 4.5 * (1 + energy * 2.5);
    for (let i = 0; i < parallaxStars.length; i++) {
      const s = parallaxStars[i];
      const layerSpeed = (s.layer + 1) * 0.45;
      s.x -= baseDrift * layerSpeed * dt;
      s.y -= baseDrift * layerSpeed * 0.22 * dt;

      if (s.x < -8) s.x = width + 8;
      if (s.y < -8) s.y = height + 8;

      const twinkle =
        0.68 + 0.32 * Math.sin((now / 350) * s.twinkleSpeed * (1 + energy * 0.6) + s.phase);
      const alpha = Math.min(1, s.alpha * twinkle * (0.85 + energy * 0.3));

      if (s.layer === 2) {
        drawCrossStar(s.x, s.y, s.r, s.tint, alpha);
      } else {
        ctx.fillStyle = s.tint;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 发射一颗划过深空的流星
  function spawnMeteor(): void {
    const startX = width * (0.2 + Math.random() * 0.75);
    const startY = Math.random() * height * 0.35;
    const angle = Math.PI * (0.78 + Math.random() * 0.12); // 向左下方划落
    const speedVal = 520 + Math.random() * 340;
    meteors.push({
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speedVal,
      vy: Math.sin(angle) * speedVal,
      len: 55 + Math.random() * 65,
      life: 0,
      span: 0.45 + Math.random() * 0.35,
    });
  }

  // ==================== 通用层：深空流星（所有引擎共用） ====================
  function renderMeteors(dt: number): void {
    // 极低概率偶发自然流星，打字能量高时概率提升
    if (Math.random() < 0.002 + energy * 0.012 && meteors.length < 3) {
      spawnMeteor();
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.life += dt;
      if (m.life >= m.span) {
        meteors.splice(i, 1);
        continue;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const k = Math.sin((m.life / m.span) * Math.PI);
      const norm = Math.hypot(m.vx, m.vy) || 1;
      const tx = m.x - (m.vx / norm) * m.len;
      const ty = m.y - (m.vy / norm) * m.len;

      const grad = ctx.createLinearGradient(m.x, m.y, tx, ty);
      grad.addColorStop(0, palette.meteor);
      grad.addColorStop(0.3, spark);
      grad.addColorStop(1, "transparent");

      ctx.save();
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = k * 0.9;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();
    }
  }

  return {
    resize(nextWidth: number, nextHeight: number): void {
      // 隐藏时保留最后的有效几何，恢复显示仍复用粒子状态。
      if (nextWidth <= 0 || nextHeight <= 0) return;
      const previousWidth = width;
      const previousHeight = height;
      width = nextWidth;
      height = nextHeight;
      layoutArray();
      if (previousWidth > 0 && previousHeight > 0) {
        // 拖宽侧栏和输入框增高只调整坐标，不反复重建随机星场、重播法阵入场。
        const scaleX = width / previousWidth;
        const scaleY = height / previousHeight;
        caret.x *= scaleX;
        caret.y *= scaleY;
        for (const points of [parts, parallaxStars, meteors]) {
          for (const point of points) {
            point.x *= scaleX;
            point.y *= scaleY;
          }
        }
        return;
      }
      caret.x = Math.min(width * 0.3, 140);
      caret.y = height * 0.45;
      if (effect === "nebula") initParallaxStars();
      parts.length = 0;
      runes.length = 0;
      meteors.length = 0;
      if (effect === "ember") for (let i = 0; i < 26; i++) spawnEmber(true);
      if (effect === "triforce") {
        for (let i = 0; i < 12; i++) spawnSheikahMote(true);
        arrayIn = 0;
        triggerArrayPulse();
      }
    },
    setPalette(next: InputAuraPalette): void {
      palette = next;
      spark = next.spark;
      goldTone = next.gold;
      parallaxStars.forEach((star, index) => {
        star.tint = next.stars[index % next.stars.length] ?? spark;
      });
    },
    setCaret(x: number): void {
      caret.x = Math.max(24, Math.min(width - 24, x));
    },
    input(): void {
      energy = Math.min(INPUT_AURA_MOTION.energyMax, energy + INPUT_AURA_MOTION.strokeEnergy);
      strokes = Math.min(4, strokes + 1);
    },
    render(now: number, dt: number): void {
      energy *= Math.exp(-dt / INPUT_AURA_MOTION.energyDecay);
      pulse *= Math.exp(-dt / INPUT_AURA_MOTION.pulseDecay);
      if (strokes > 0) {
        strokes = 0;
        pulse = 1;
      }
      speed += (1 + energy * 6 - speed) * (1 - Math.exp(-dt / INPUT_AURA_MOTION.speedResponse));
      // 每帧重置画笔，避免某个引擎的阴影/透明度污染下一帧的星云底光。
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      if (effect === "ember") renderEmber(now, dt);
      else if (effect === "aurora") renderAurora(now);
      else if (effect === "triforce") renderTriforce(now, dt);
      else renderNebula(now, dt);
      renderMeteors(dt);
      ctx.restore();
    },
  };
}
