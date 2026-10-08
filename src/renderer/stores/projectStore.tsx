import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PideskProject } from "../../shared/ipc";
import { projectService } from "../services/projectService";
import { settingsService } from "../services/settingsService";

interface ProjectStoreValue {
  projects: PideskProject[];
  currentProject: PideskProject | null;
  /** 设置是否已加载（启动瞬间避免误判为"无项目"）。 */
  ready: boolean;
  selectProject: (id: string | null) => void;
  removeProject: (id: string) => void;
  /** 通过系统文件夹选择器添加项目；取消/失败返回 null。添加后自动选中。 */
  addProjectByPicker: () => Promise<PideskProject | null>;
}

const ProjectStoreContext = createContext<ProjectStoreValue | null>(null);

function basename(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? dir;
}

/** 项目状态：项目 = 本地目录，列表持久化到 PiDesk 设置（docs/design/03 §2）。 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<PideskProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // 异步回调里需要最新列表做去重，setState updater 不保证同步执行
  const projectsRef = useRef<PideskProject[]>([]);
  projectsRef.current = projects;

  // 启动时从设置恢复项目列表与上次选中的项目
  useEffect(() => {
    let cancelled = false;
    settingsService.get().then((settings) => {
      if (cancelled) return;
      if (settings) {
        setProjects(settings.projects);
        setCurrentProjectId(settings.lastProjectId ?? null);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectProject = useCallback((id: string | null) => {
    setCurrentProjectId(id);
    settingsService.set({ lastProjectId: id });
  }, []);

  const removeProject = useCallback(
    (id: string) => {
      const next = projectsRef.current.filter((p) => p.id !== id);
      setProjects(next);
      settingsService.set({ projects: next });
      if (currentProjectId === id) {
        setCurrentProjectId(null);
        settingsService.set({ lastProjectId: null });
      }
    },
    [currentProjectId],
  );

  const addProjectByPicker = useCallback(async (): Promise<PideskProject | null> => {
    const settings = await settingsService.get();
    const dir = await projectService.pickDirectory(settings?.defaultProjectDir ?? null);
    if (!dir) return null;
    const normalized = dir.replace(/[\\/]+$/, "");
    const existing = projectsRef.current.find(
      (p) => p.dir.toLowerCase() === normalized.toLowerCase(),
    );
    if (existing) {
      selectProject(existing.id);
      return existing;
    }
    const added: PideskProject = {
      id: `proj-${crypto.randomUUID()}`,
      name: basename(normalized),
      dir: normalized,
    };
    const next = [...projectsRef.current, added];
    setProjects(next);
    settingsService.set({ projects: next });
    selectProject(added.id);
    return added;
  }, [selectProject]);

  const value = useMemo<ProjectStoreValue>(
    () => ({
      projects,
      currentProject: projects.find((p) => p.id === currentProjectId) ?? null,
      ready,
      selectProject,
      removeProject,
      addProjectByPicker,
    }),
    [projects, currentProjectId, ready, selectProject, removeProject, addProjectByPicker],
  );

  return <ProjectStoreContext.Provider value={value}>{children}</ProjectStoreContext.Provider>;
}

export function useProjectStore(): ProjectStoreValue {
  const ctx = useContext(ProjectStoreContext);
  if (!ctx) throw new Error("useProjectStore 必须在 ProjectProvider 内使用");
  return ctx;
}
