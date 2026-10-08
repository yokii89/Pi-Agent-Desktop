/**
 * 生成应用图标栅格资产（build/icon.png 与 build/icon.ico）。
 *
 * 用法：pnpm run gen:app-icon
 * （仅在更换应用图标时手动运行；日常构建直接使用已提交的 build/ 产物，不依赖本脚本。）
 *
 * 源文件：`src/renderer/assets/app-icon/app-icon.png`（1024×1024 RGBA 母版）。
 * 母版直接拷贝为 build/icon.png，再用 Electron `nativeImage.resize` 导出各档尺寸打包 ICO——
 * 不必为「PNG 缩放 / ICO 打包」引入 sharp / png-to-ico 等额外依赖。
 *
 * 输出：
 * - build/icon.png —— 1024×1024 RGBA 母版（与源文件一致）
 * - build/icon.ico —— 内置 16/24/32/48/64/128/256 七档尺寸的 Windows 图标容器
 *
 * 关于 ICO 里塞 PNG：Windows Vista 起 ICO 允许条目直接存放 PNG 数据（仅 256×256 常见），
 * 但为稳妥（部分旧组件只认 BMP），这里对 ≤64 的尺寸仍写 PNG —— 实测 explorer / 任务栏 /
 * Alt+Tab 均正常。若将来遇到极端兼容问题，可改为把这些尺寸展开成 BMP（DIB）条目。
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourcePng = path.join(projectRoot, "src/renderer/assets/app-icon/app-icon.png");
const buildDir = path.join(projectRoot, "build");
const pngOut = path.join(buildDir, "icon.png");
const icoOut = path.join(buildDir, "icon.ico");

/** ICO 内置的尺寸档；Windows 各场景按需取最接近的一档，缺档会降采样导致模糊。 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** 母版边长，需足够大以覆盖最大档 256 并留出余量。 */
const MASTER_SIZE = 1024;

/**
 * 把若干「尺寸 + PNG 字节」打包成 ICO 容器。
 * ICO 结构：6 字节文件头 + 每图 16 字节目录项 + 各图数据区。
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved，固定 0
  header.writeUInt16LE(1, 2); // type：1 = icon（0 为 cursor）
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let dataOffset = 6 + 16 * entries.length;
  const blobs = [];

  entries.forEach((entry, i) => {
    const base = 16 * i;
    // 目录项里宽高是单字节，256 需写 0（既有的约定，不是 bug）
    const dimension = entry.size >= 256 ? 0 : entry.size;
    directory.writeUInt8(dimension, base + 0); // width
    directory.writeUInt8(dimension, base + 1); // height
    directory.writeUInt8(0, base + 2); // 调色板颜色数（真彩色为 0）
    directory.writeUInt8(0, base + 3); // reserved
    directory.writeUInt16LE(1, base + 4); // color planes
    directory.writeUInt16LE(32, base + 6); // bits per pixel
    directory.writeUInt32LE(entry.data.length, base + 8);
    directory.writeUInt32LE(dataOffset, base + 12);
    dataOffset += entry.data.length;
    blobs.push(entry.data);
  });

  return Buffer.concat([header, directory, ...blobs]);
}

/** 用 Electron `nativeImage` 把母版缩放到各档尺寸并导出 PNG 字节。 */
function resizeViaElectron() {
  return new Promise((resolve, reject) => {
    // Electron 不支持 Node 的 `-e`（实测静默无输出），必须落一个真实入口文件。
    // 入口放在项目根：app.getAppPath() 依赖它定位，且与 E2E 脚本的既有做法一致。
    const entryFile = path.join(projectRoot, ".gen-app-icon.tmp.cjs");

    const script = `
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("no-sandbox");

const srcPng = process.env.SRC_PNG;
const outDir = process.env.OUT_DIR;
const sizes = JSON.parse(process.env.SIZES);

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(srcPng);
  if (img.isEmpty()) {
    console.error("[app-icon] 无法加载母版 PNG");
    app.exit(1);
    return;
  }

  const entries = sizes.map((size) => {
    const resized = img.resize({ width: size, height: size, quality: "best" });
    return { size, b64: resized.toPNG().toString("base64") };
  });
  fs.writeFileSync(path.join(outDir, ".sizes.json"), JSON.stringify(entries));
  console.log("[app-icon] 缩放完成");
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
`;

    writeFile(entryFile, script)
      .then(() => {
        const electronBin = require("electron");
        const child = spawn(electronBin, [entryFile], {
          cwd: projectRoot,
          env: {
            ...process.env,
            SRC_PNG: sourcePng,
            OUT_DIR: buildDir,
            SIZES: JSON.stringify(ICO_SIZES),
          },
          stdio: "inherit",
        });
        child.on("exit", async (code) => {
          await rm(entryFile, { force: true });
          if (code === 0) resolve();
          else reject(new Error(`Electron 缩放失败，退出码 ${code}`));
        });
      })
      .catch(reject);
  });
}

async function main() {
  await mkdir(buildDir, { recursive: true });

  try {
    await stat(sourcePng);
  } catch {
    throw new Error(`找不到源 PNG：${sourcePng}`);
  }

  console.log("[app-icon] 拷贝母版…");
  await copyFile(sourcePng, pngOut);

  console.log("[app-icon] 缩放各档尺寸…");
  await resizeViaElectron();

  const sizesJson = JSON.parse(await readFile(path.join(buildDir, ".sizes.json"), "utf8"));
  const entries = sizesJson.map((e) => ({ size: e.size, data: Buffer.from(e.b64, "base64") }));
  await writeFile(icoOut, buildIco(entries));
  await rm(path.join(buildDir, ".sizes.json"), { force: true });

  const pngSize = (await stat(pngOut)).size;
  const icoSize = (await stat(icoOut)).size;
  console.log(`[app-icon] 完成：`);
  console.log(
    `  ${path.relative(projectRoot, pngOut)}  ${MASTER_SIZE}×${MASTER_SIZE}  ${pngSize} bytes`,
  );
  console.log(`  ${path.relative(projectRoot, icoOut)}  ${ICO_SIZES.join("/")}  ${icoSize} bytes`);
}

main().catch((error) => {
  console.error("[app-icon] 生成失败：", error.message);
  process.exit(1);
});
