import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 项目 = 本地目录；选择器由主进程系统对话框承担。 */
export const projectService = {
  /** 打开系统文件夹选择器；取消返回 null。defaultPath 为空时主进程落到 PiDeskProjects。 */
  pickDirectory(defaultPath?: string | null): Promise<string | null> {
    const api = pideskApi();
    return api ? unwrap(api.project.pick(defaultPath)).catch(() => null) : Promise.resolve(null);
  },
};
