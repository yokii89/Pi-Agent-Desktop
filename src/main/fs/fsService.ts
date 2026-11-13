import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { app, dialog, shell } from "electron";
import { IMAGE_EXTS, IMAGE_MIME, PDF_EXTS } from "../../shared/fileKinds";
import type {
  FsEntry,
  FsListResult,
  FsReadResult,
  FsSaveImageRequest,
  FsSaveImageResult,
  FsSearchHit,
} from "../../shared/ipc";
import { parseImageDataUrl, pickAvailablePath, toSaveFileName } from "./saveImageName";
import { matchesFileQuery, rankFileSearchHits } from "./searchMatch";

/** 单目录列出上限（docs/design/03 §5：超出折叠为"展开更多"）。 */
const MAX_LIST_ENTRIES = 500;
/** 文本只读上限（1MB），超出截断。 */
const MAX_READ_BYTES = 1024 * 1024;
/** 图片预览上限（base64 会再涨约 1/3，IPC 仍可接受）。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** PDF 经 IPC 传递的上限，避免超大文档造成主/渲染进程内存峰值。 */
const MAX_PDF_BYTES = 40 * 1024 * 1024;
/** 搜索匹配条数上限。 */
const MAX_SEARCH_HITS = 50;
/** 搜索遍历的目录项总量上限（防 node_modules 之外的异常大目录拖垮主进程）。 */
const MAX_SEARCH_VISITS = 5000;
/** 搜索时跳过的目录名。 */
const SEARCH_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);
/** 搜索最大递归深度。 */
const MAX_SEARCH_DEPTH = 8;

/** 列出目录：文件夹在前、字母序（docs/design/03 §5）。 */
export function listDirectory(dir: string): FsListResult {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const entries: FsEntry[] = dirents.map((d) => ({
    name: d.name,
    kind: d.isDirectory() ? "dir" : "file",
  }));
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const truncated = entries.length > MAX_LIST_ENTRIES;
  return { entries: entries.slice(0, MAX_LIST_ENTRIES), truncated };
}

/** 读前若干字节判断是否二进制（NUL 字节）。 */
function looksBinary(buffer: Buffer): boolean {
  const probe = buffer.subarray(0, Math.min(buffer.length, 8000));
  return probe.includes(0);
}

/**
 * 只读读取文件并按类型分流：
 * - 图片（扩展名命中）→ base64 data URL，供侧栏 <img> 直接展示
 * - 文本（无 NUL）→ UTF-8，超限截断
 * - 其余 → binary 占位（只回元信息，避免把乱码灌进 UI）
 */
export function readFile(file: string): FsReadResult {
  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    throw new Error("不是常规文件");
  }
  const ext = path.extname(file).slice(1).toLowerCase();
  if ((PDF_EXTS as readonly string[]).includes(ext)) {
    if (stat.size > MAX_PDF_BYTES) {
      throw new Error("PDF 文件过大，无法在侧栏预览（上限 40MB）");
    }
    return {
      kind: "pdf",
      data: new Uint8Array(fs.readFileSync(file)),
      byteLength: stat.size,
    };
  }

  const imageMime = (IMAGE_EXTS as readonly string[]).includes(ext)
    ? IMAGE_MIME[ext as (typeof IMAGE_EXTS)[number]]
    : undefined;

  if (imageMime) {
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new Error("图片过大，无法在侧栏预览（上限 10MB）");
    }
    const buf = fs.readFileSync(file);
    return {
      kind: "image",
      dataUrl: `data:${imageMime};base64,${buf.toString("base64")}`,
      mime: imageMime,
      byteLength: stat.size,
    };
  }

  const size = Math.min(stat.size, MAX_READ_BYTES);
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, 0);
    if (looksBinary(buffer)) {
      return { kind: "binary", byteLength: stat.size };
    }
    return {
      kind: "text",
      content: buffer.toString("utf8"),
      truncated: stat.size > MAX_READ_BYTES,
      byteLength: stat.size,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 递归模糊搜索文件与文件夹（大小写不敏感）。
 * - 关键词为空：返回根下浅层目录 + 若干文件（@ 浏览默认列表）。
 * - 有关键词：子序列模糊匹配，文件名相关度优先于路径命中；
 *   命中集合排序后取前 50 条。
 * 异步 readdir，避免大仓库快速打开时阻塞主进程。
 */
export async function searchFiles(rootDir: string, query: string): Promise<FsSearchHit[]> {
  const keyword = query.trim().toLowerCase();
  const hits: FsSearchHit[] = [];
  let visited = 0;

  const pushHit = (full: string, kind: "dir" | "file"): void => {
    hits.push({
      path: full,
      displayPath: path.relative(rootDir, full).split(path.sep).join("/"),
      kind,
    });
  };

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (
      (keyword.length === 0 && hits.length >= MAX_SEARCH_HITS) ||
      visited >= MAX_SEARCH_VISITS ||
      depth > MAX_SEARCH_DEPTH
    ) {
      return;
    }
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // 目录优先，便于 @ 浏览时先看到结构
    dirents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()));

    for (const dirent of dirents) {
      visited += 1;
      if (
        visited >= MAX_SEARCH_VISITS ||
        (keyword.length === 0 && hits.length >= MAX_SEARCH_HITS)
      ) {
        return;
      }
      const full = path.join(dir, dirent.name);
      const rel = path.relative(rootDir, full).split(path.sep).join("/");

      if (dirent.isDirectory()) {
        if (SEARCH_SKIP_DIRS.has(dirent.name)) continue;
        // 空查询：只收浅层目录；有查询：子序列模糊命中
        const matched =
          keyword.length === 0 ? depth < 2 : matchesFileQuery(dirent.name, rel, keyword);
        if (matched) pushHit(full, "dir");
        // 有查询时继续下钻找文件；空查询也下钻一层找文件
        if (keyword.length > 0 || depth < 1) await walk(full, depth + 1);
        continue;
      }

      if (!dirent.isFile()) continue;
      const matched =
        keyword.length === 0 ? depth < 1 : matchesFileQuery(dirent.name, rel, keyword);
      if (matched) pushHit(full, "file");
    }
  };

  await walk(rootDir, 0);
  return rankFileSearchHits(hits, keyword).slice(0, MAX_SEARCH_HITS);
}

/** 系统文件选择器（单选文件），取消时返回 null。 */
export async function pickFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "可执行文件", extensions: ["exe", "cmd", "bat"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

/**
 * 用系统默认应用打开路径（目录在资源管理器中打开，文件用关联程序打开）。
 * 会话流 FileLink / 侧栏「打开文件夹」共用本通道。
 * 先自查存在性：`shell.openPath` 对不存在的路径只返回一句系统文案，
 * 在这里拦掉能给出更明确的中文错误。
 */
export async function openDirectory(target: string): Promise<void> {
  try {
    fs.statSync(target);
  } catch {
    throw new Error("路径不存在或已被移动");
  }
  const failure = await shell.openPath(target);
  if (failure) throw new Error(failure);
}

/** VS Code 常见安装位置（PiDesk 仅发布 Windows；「环境变量名/相对路径」两段式）。 */
const VS_CODE_EXE_CANDIDATES = [
  "LOCALAPPDATA/Programs/Microsoft VS Code/Code.exe",
  "ProgramFiles/Microsoft VS Code/Code.exe",
  "ProgramFiles(x86)/Microsoft VS Code/Code.exe",
] as const;

/** 依序探测已知安装位置；都不存在返回 null，交给 PATH 兜底。 */
function findVsCodeExe(): string | null {
  for (const candidate of VS_CODE_EXE_CANDIDATES) {
    const sep = candidate.indexOf("/");
    const base = process.env[candidate.slice(0, sep)];
    if (!base) continue;
    const exe = path.join(base, candidate.slice(sep + 1));
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

/** 分离启动一个进程：借 spawn 事件确认真的起来了（PATH 里找不到等失败转成可读拒绝）。 */
function spawnDetached(
  command: string,
  args: string[],
  options?: { verbatimArgs?: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: options?.verbatimArgs === true,
    });
    child.once("error", reject);
    child.once("spawn", () => resolve());
    child.unref();
  });
}

/**
 * `where code` 找 PATH 里的 code shim；只认 cmd 能执行的形态（.cmd/.exe/.bat）——
 * `where` 也会列出无扩展名的 bash shim（VS Code bin 目录两者并存），喂给 cmd 会失败。
 * 找不到（非零退出 / 只有 bash shim）返回 null。
 */
function findCodeOnPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("where", ["code"], { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const shims = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /\.(cmd|exe|bat)$/i.test(line));
      resolve(shims[0] ?? null);
    });
  });
}

/**
 * 用 VS Code 打开目录（顶栏工作区按钮）。探测顺序：已知安装位置的 Code.exe →
 * PATH 里的 code shim（`where code`）→ shim 上级的真实 Code.exe → cmd 兜底执行 shim。
 * 都不可用或启动失败时给出可读错误——VS Code 的「添加到 PATH」是安装器可选项，
 * 静默失败会表现成"点了没反应"。
 */
export async function openInVsCode(target: string): Promise<void> {
  try {
    fs.statSync(target);
  } catch {
    throw new Error("路径不存在或已被移动");
  }
  const notFound = () => new Error("未检测到 VS Code，请确认已安装并在安装时勾选了「添加到 PATH」");

  const exe = findVsCodeExe();
  const launchDirect = exe ? (): Promise<void> => spawnDetached(exe, [target]) : null;

  const shim = launchDirect ? null : await findCodeOnPath();
  // shim 约定在 <安装根>/bin/code.cmd，真实主体是上级目录的 Code.exe：
  // 直接 spawn 免受 cmd 引号规则影响（路径含空格时 shell:true 会截断命令）
  const shimRootExe = shim?.toLowerCase().endsWith(".cmd")
    ? path.join(path.dirname(path.dirname(shim)), "Code.exe")
    : null;
  const launchViaShim =
    shim && shimRootExe && fs.existsSync(shimRootExe)
      ? (): Promise<void> => spawnDetached(shimRootExe, [target])
      : shim
        ? (): Promise<void> =>
            // 兜底：cmd /s /c 执行 shim（整段自带外层引号，verbatim 原样传给 cmd）
            spawnDetached("cmd.exe", ["/d", "/s", "/c", `""${shim}" "${target}""`], {
              verbatimArgs: true,
            })
        : null;

  const launch = launchDirect ?? launchViaShim;
  if (!launch) throw notFound();
  try {
    await launch();
  } catch {
    throw notFound();
  }
}

// ---------------------------------------------------------------------------
// 保存图片到「下载」（文件名净化与 data URL 解析见 saveImageName.ts）
// ---------------------------------------------------------------------------

/**
 * 把 data URL 图片写入系统「下载」目录（lightbox 右键「保存图片」）。
 * 只在 downloads 段内拼文件名：渲染层传来的 name 永不参与目录选择。
 */
export async function saveImageToDownloads(req: FsSaveImageRequest): Promise<FsSaveImageResult> {
  const parsed = parseImageDataUrl(req.dataUrl);
  if (!parsed) throw new Error("图片数据不可用");
  // base64 长度 ×3/4 ≈ 字节数；沿用图片预览的 10MB 上限
  if (parsed.base64.length * 0.75 > MAX_IMAGE_BYTES) throw new Error("图片过大，无法保存");
  const dir = app.getPath("downloads");
  const target = pickAvailablePath(dir, toSaveFileName(req.name, parsed.mimeType));
  await fsp.writeFile(target, Buffer.from(parsed.base64, "base64"));
  return { path: target, name: path.basename(target), dir };
}
