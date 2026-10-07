import type { FsListResult, FsReadResult, FsSearchHit, FsWatchPushMessage } from "../../shared/ipc";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 文件树 / 只读预览 / 文件名搜索（主进程 fs 模块）。 */
export const fsService = {
  list(dir: string): Promise<FsListResult> {
    const api = pideskApi();
    if (!api) return Promise.resolve({ entries: [], truncated: false });
    return unwrap(api.fs.list(dir));
  },
  read(path: string): Promise<FsReadResult> {
    const api = pideskApi();
    if (!api)
      return Promise.resolve({
        kind: "text",
        content: "",
        truncated: false,
        byteLength: 0,
      });
    return unwrap(api.fs.read(path));
  },
  search(dir: string, query: string): Promise<FsSearchHit[]> {
    const api = pideskApi();
    if (!api) return Promise.resolve([]);
    return unwrap(api.fs.search(dir, query)).catch(() => []);
  },
  pickFile(): Promise<string | null> {
    const api = pideskApi();
    return api ? unwrap(api.fs.pickFile()).catch(() => null) : Promise.resolve(null);
  },
  /** 在系统文件管理器中打开目录；失败（不存在等）向调用方抛出可展示的错误。 */
  async openPath(dir: string): Promise<void> {
    const api = pideskApi();
    if (!api) return;
    await unwrap(api.fs.openPath(dir));
  },
  /** 订阅目录变动（引用计数 +1）；仅监听文件树中已展开的目录。 */
  watch(dir: string): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.fs.watch(dir)).then(() => undefined);
  },
  /** 退订目录变动（引用计数 -1）。 */
  unwatch(dir: string): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.fs.unwatch(dir)).then(() => undefined);
  },
  /** 订阅目录变动推送；返回取消订阅函数（preload 未就绪时返回空操作）。 */
  onChanged(callback: (message: FsWatchPushMessage) => void): () => void {
    const api = pideskApi();
    if (!api) return () => {};
    return api.fs.onChanged(callback);
  },
};
