/**
 * 生成文件类型图标资产与映射（src/renderer/fileIcons/）。
 *
 * 用法：pnpm run gen:file-icons（需要网络；仅在更新图标集时手动运行，日常构建不依赖本脚本）。
 *
 * 数据来源：
 * - 图标集与扩展名映射：https://github.com/peakoss/vscode-jetbrains-icon-theme（2023 图标集）
 *   - 图标原始出处为 JetBrains Design Resources（https://intellij-icons.jetbrains.design/，Apache 2.0）
 *   - 主题映射代码为 MIT
 * - 仅取文件图标（fileExtensions / fileNames / 默认图标），文件夹图标不在本资产范围内。
 *
 * 输出：
 * - fileIcons/assets/light/<定义名>.svg、assets/dark/<定义名>.svg —— 同一图标名两套主题；
 *   暗色变体按上游 `<base>_dark.svg` 命名规律探测，无变体时运行时回退浅色
 * - fileIcons/mapping.ts —— 后缀/文件名 → 图标定义名的生成物，禁止手改
 * - fileIcons/NOTICE.md、fileIcons/LICENSE.md —— 许可与出处说明
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_BASE =
  "https://raw.githubusercontent.com/peakoss/vscode-jetbrains-icon-theme/main/assets/2023";
const SOURCE_LICENSE_URL =
  "https://raw.githubusercontent.com/peakoss/vscode-jetbrains-icon-theme/main/LICENSE.md";

const fileIconsDir = path.resolve(import.meta.dirname, "../src/renderer/fileIcons");
const assetsDir = path.join(fileIconsDir, "assets");
const mappingFile = path.join(fileIconsDir, "mapping.ts");

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载失败（HTTP ${res.status}）：${url}`);
  }
  return res.text();
}

/** 上游 iconDefinitions 只引用浅色文件名，暗色变体按 `<base>_dark.svg` 命名规律探测，404 视为无变体。 */
async function fetchOptionalText(url) {
  const res = await fetch(url);
  return res.ok ? res.text() : null;
}

const theme = JSON.parse(await fetchText(`${SOURCE_BASE}/theme-light.json`));

// VSCode 图标主题约定：顶层 file 字段是未命中任何映射时的默认图标名。
const defaultIcon = typeof theme.file === "string" ? theme.file : "text";

// folderNames 对应的文件夹图标不在本资产范围内，故只用 fileExtensions + fileNames 收集图标名。
const usedIconNames = new Set([
  ...Object.values(theme.fileExtensions ?? {}),
  ...Object.values(theme.fileNames ?? {}),
  defaultIcon,
]);

const iconDefs = theme.iconDefinitions ?? {};
const items = [];
const missingDefs = [];
for (const name of usedIconNames) {
  const iconPath = iconDefs[name]?.iconPath;
  if (typeof iconPath !== "string") {
    missingDefs.push(name);
    continue;
  }
  // iconPath 形如 "./icons/css.svg"；磁盘文件统一改用定义名命名，
  // 保证 mapping.ts 引用的名字与 assets/{light,dark}/ 下的文件名一致。
  const upstreamFile = iconPath.replaceAll("\\", "/").split("/").pop();
  items.push({
    name,
    url: `${SOURCE_BASE}/icons/${upstreamFile}`,
    darkUrl: `${SOURCE_BASE}/icons/${upstreamFile.replace(/\.svg$/, "_dark.svg")}`,
  });
}

if (missingDefs.length > 0) {
  console.warn(
    `警告：以下图标名在 iconDefinitions 中缺失，相关映射将被丢弃：${missingDefs.join(", ")}`,
  );
}

await rm(path.join(assetsDir, "light"), { recursive: true, force: true });
await rm(path.join(assetsDir, "dark"), { recursive: true, force: true });
await mkdir(path.join(assetsDir, "light"), { recursive: true });
await mkdir(path.join(assetsDir, "dark"), { recursive: true });

let lightCount = 0;
let darkCount = 0;
const failures = [];
const batchSize = 12;
for (let i = 0; i < items.length; i += batchSize) {
  await Promise.all(
    items.slice(i, i + batchSize).map(async (item) => {
      try {
        await writeFile(
          path.join(assetsDir, "light", `${item.name}.svg`),
          await fetchText(item.url),
        );
        lightCount += 1;
        const darkSvg = await fetchOptionalText(item.darkUrl);
        if (darkSvg) {
          await writeFile(path.join(assetsDir, "dark", `${item.name}.svg`), darkSvg);
          darkCount += 1;
        }
      } catch (error) {
        failures.push(`${item.name}: ${error.message}`);
      }
    }),
  );
}
if (failures.length > 0) {
  console.warn(
    `警告：${failures.length} 个图标下载失败，相关映射将被丢弃：\n  ${failures.join("\n  ")}`,
  );
}

const okNames = new Set(
  items
    .filter((item) => !failures.some((f) => f.startsWith(`${item.name}: `)))
    .map((item) => item.name),
);

// 映射键统一小写：后缀在 Windows/macOS 上大小写不敏感；文件名（含 .gitignore 等点前缀）
// 精确匹配也按小写处理，仅后缀键需要去掉前导点。
function normalizeKeys(entries, { stripLeadingDot = false } = {}) {
  const result = {};
  for (const [key, value] of Object.entries(entries ?? {})) {
    if (!okNames.has(value)) continue;
    const lower = stripLeadingDot ? key.toLowerCase().replace(/^\./, "") : key.toLowerCase();
    result[lower] = value;
  }
  return result;
}

if (!okNames.has(defaultIcon)) {
  throw new Error(`默认图标 "${defaultIcon}" 未能下载，终止生成`);
}

const fileExtensions = normalizeKeys(theme.fileExtensions, { stripLeadingDot: true });
const fileNames = normalizeKeys(theme.fileNames);

const mappingTs = `/**
 * 文件后缀/文件名 → 图标定义名的映射数据。由 scripts/generate-file-icons.mjs 生成，禁止手改。
 * 重新生成：pnpm run gen:file-icons
 *
 * 图标名对应 fileIcons/assets/{light,dark}/<name>.svg；
 * 来源 peakoss/vscode-jetbrains-icon-theme（2023 图标集），许可见同目录 LICENSE.md / NOTICE.md。
 */
export const FILE_EXTENSIONS: Readonly<Record<string, string>> = ${JSON.stringify(fileExtensions, null, 2)};

export const FILE_NAMES: Readonly<Record<string, string>> = ${JSON.stringify(fileNames, null, 2)};

/** 未命中任何映射时的兜底图标名（通用文档图标）。 */
export const DEFAULT_FILE_ICON = ${JSON.stringify(defaultIcon)};
`;

await writeFile(mappingFile, mappingTs);

const notice = `# 文件类型图标来源与许可（生成于 ${new Date().toISOString().slice(0, 10)}）

- 图标与映射来源：[peakoss/vscode-jetbrains-icon-theme](https://github.com/peakoss/vscode-jetbrains-icon-theme)（2023 图标集，\`assets/2023/\`）。
- 图标原始出处：[JetBrains Design Resources](https://intellij-icons.jetbrains.design/)（IntelliJ 平台开源仓库图标，Apache 2.0）。
- 上游主题映射代码：MIT，全文见同目录 [LICENSE.md](./LICENSE.md)；其中 Elixir 相关图标来自 intellij-elixir（Apache 2.0），见 LICENSE.md 内说明。
- 本目录相对上游的改动仅为文件名归一化：以主题 iconDefinitions 的定义名命名，暗色变体从 \`<base>_dark.svg\` 拆分到 \`assets/dark/\`；未使用的图标与文件夹图标未打包。
- 重新生成：\`pnpm run gen:file-icons\`（scripts/generate-file-icons.mjs，需要网络）。
`;

await writeFile(path.join(fileIconsDir, "NOTICE.md"), notice);
await writeFile(path.join(fileIconsDir, "LICENSE.md"), await fetchText(SOURCE_LICENSE_URL));

console.log(
  `完成：fileExtensions ${Object.keys(fileExtensions).length} 条 / fileNames ${Object.keys(fileNames).length} 条 / 默认图标 "${defaultIcon}" / light ${lightCount} / dark ${darkCount}`,
);
