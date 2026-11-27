/**
 * 生成应用图标资源（build/icon.png、build/icon.ico、build/app-icons/* 与设置页缩略图）。
 * 各款 PNG 母版由 Electron nativeImage 缩放并输出多尺寸 ICO；不增加依赖。
 * 设置页 52px 的预览只用 128px 缩略图，避免把 1024 母版打进渲染层。
 * 仅在图标美术变更时手动运行：pnpm run gen:app-icon。
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(projectRoot, "src/renderer/assets/app-icon");
const sourcePng = path.join(sourceDir, "app-icon.png");
const buildDir = path.join(projectRoot, "build");
const iconsDir = path.join(buildDir, "app-icons");
/** 设置页预览缩略图（随渲染层打包）：52px 展示，2x 屏用 128px 足够。 */
const previewDir = path.join(sourceDir, "preview");
const PREVIEW_SIDE = 128;
const pngOut = path.join(buildDir, "icon.png");
const icoOut = path.join(buildDir, "icon.ico");
const SIZES_FILE = path.join(iconsDir, ".sizes.json");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const MASTER_SIZE = 1024;
const ICON_SOURCES = [
  { id: "classic", path: sourcePng },
  { id: "blue", path: path.join(sourceDir, "P-icon-blue.png") },
  { id: "green", path: path.join(sourceDir, "P-icon-green.png") },
  { id: "pink", path: path.join(sourceDir, "P-icon-pink.png") },
  { id: "yellow", path: path.join(sourceDir, "P-icon-yellow.png") },
];

/** 把若干尺寸的 PNG 字节打包为 Windows ICO 容器。 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let dataOffset = 6 + 16 * entries.length;
  const blobs = [];
  entries.forEach((entry, index) => {
    const base = 16 * index;
    const dimension = entry.size >= 256 ? 0 : entry.size;
    directory.writeUInt8(dimension, base);
    directory.writeUInt8(dimension, base + 1);
    directory.writeUInt8(0, base + 2);
    directory.writeUInt8(0, base + 3);
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(entry.data.length, base + 8);
    directory.writeUInt32LE(dataOffset, base + 12);
    dataOffset += entry.data.length;
    blobs.push(entry.data);
  });
  return Buffer.concat([header, directory, ...blobs]);
}

/** 由 Electron 缩放 PNG 母版并生成主图及 ICO 各尺寸 PNG。 */
function renderIconsViaElectron() {
  return new Promise((resolve, reject) => {
    const entryFile = path.join(projectRoot, ".gen-app-icon.tmp.cjs");
    const script = `
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();

const sources = JSON.parse(process.env.ICON_SOURCES);
const outDir = process.env.OUT_DIR;
const previewDir = process.env.PREVIEW_DIR;
const previewSide = Number(process.env.PREVIEW_SIDE);
const sizes = JSON.parse(process.env.SIZES);

function visibleBounds(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bitmap[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error("图标没有可见内容");
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function enlargePreview(image, minimumSide) {
  const bounds = visibleBounds(image);
  const side = Math.max(bounds.width, bounds.height);
  if (side >= minimumSide) return image;
  const width = Math.round(bounds.width * minimumSide / side);
  const height = Math.round(bounds.height * minimumSide / side);
  const resized = image.crop(bounds).resize({ width, height, quality: "best" }).toBitmap();
  const canvas = Buffer.alloc(previewSide * previewSide * 4);
  const left = Math.floor((previewSide - width) / 2);
  const top = Math.floor((previewSide - height) / 2);
  for (let y = 0; y < height; y++) {
    resized.copy(canvas, ((top + y) * previewSide + left) * 4, y * width * 4, (y + 1) * width * 4);
  }
  return nativeImage.createFromBitmap(canvas, { width: previewSide, height: previewSide });
}

app.whenReady().then(() => {
  const output = [];
  try {
    // 透明留白不同，较小预览的可见区域向经典粉对齐；较大图标保留原样。
    const reference = nativeImage.createFromPath(sources.find(source => source.id === "classic").path)
      .resize({ width: previewSide, height: previewSide, quality: "best" });
    const referenceBounds = visibleBounds(reference);
    const minimumSide = Math.max(referenceBounds.width, referenceBounds.height);
    for (const source of sources) {
      const image = nativeImage.createFromPath(source.path);
      if (image.isEmpty()) throw new Error("无法渲染图标：" + source.id);
      const master = image.resize({ width: 1024, height: 1024, quality: "best" });
      fs.writeFileSync(path.join(outDir, source.id + ".png"), master.toPNG());
      fs.writeFileSync(
        path.join(previewDir, source.id + ".png"),
        enlargePreview(
          master.resize({ width: previewSide, height: previewSide, quality: "best" }),
          minimumSide,
        ).toPNG(),
      );
      output.push({
        id: source.id,
        entries: sizes.map(size => ({
          size,
          data: master.resize({ width: size, height: size, quality: "best" }).toPNG().toString("base64"),
        })),
      });
    }
    fs.writeFileSync(path.join(outDir, ".sizes.json"), JSON.stringify(output));
    console.log("[app-icon] 图标已渲染");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}).catch(error => { console.error(error); app.exit(1); });
`;

    writeFile(entryFile, script)
      .then(async () => {
        const electronBin = require("electron");
        const childEnv = { ...process.env };
        delete childEnv.ELECTRON_RUN_AS_NODE;
        const child = spawn(electronBin, [entryFile], {
          cwd: projectRoot,
          env: {
            ...childEnv,
            ICON_SOURCES: JSON.stringify(ICON_SOURCES),
            OUT_DIR: iconsDir,
            PREVIEW_DIR: previewDir,
            PREVIEW_SIDE: String(PREVIEW_SIDE),
            SIZES: JSON.stringify(ICO_SIZES),
          },
          stdio: "inherit",
        });
        child.on("error", async (error) => {
          await rm(entryFile, { force: true });
          reject(error);
        });
        child.on("exit", async (code) => {
          await rm(entryFile, { force: true });
          if (code === 0) resolve();
          else reject(new Error(`Electron 图标渲染失败，退出码 ${code}`));
        });
      })
      .catch(async (error) => {
        await rm(entryFile, { force: true });
        reject(error);
      });
  });
}

async function main() {
  await mkdir(buildDir, { recursive: true });
  await mkdir(iconsDir, { recursive: true });
  await mkdir(previewDir, { recursive: true });
  for (const source of ICON_SOURCES) await stat(source.path);

  console.log("[app-icon] 缩放 PNG 母版并生成 ICO…");
  await renderIconsViaElectron();
  const rendered = JSON.parse(await readFile(SIZES_FILE, "utf8"));
  for (const icon of rendered) {
    const entries = icon.entries.map((entry) => ({
      size: entry.size,
      data: Buffer.from(entry.data, "base64"),
    }));
    await writeFile(path.join(iconsDir, `${icon.id}.ico`), buildIco(entries));
  }
  await rm(SIZES_FILE, { force: true });
  await writeFile(pngOut, await readFile(path.join(iconsDir, "classic.png")));
  await writeFile(icoOut, await readFile(path.join(iconsDir, "classic.ico")));

  console.log(
    `[app-icon] 完成：${MASTER_SIZE}×${MASTER_SIZE} PNG，ICO 尺寸 ${ICO_SIZES.join("/")}`,
  );
  console.log(`[app-icon] 输出：${path.relative(projectRoot, iconsDir)}`);
  console.log(
    `[app-icon] 设置页缩略图：${path.relative(projectRoot, previewDir)}（${PREVIEW_SIDE}×${PREVIEW_SIDE}）`,
  );
}

main().catch((error) => {
  console.error("[app-icon] 生成失败：", error);
  process.exit(1);
});
