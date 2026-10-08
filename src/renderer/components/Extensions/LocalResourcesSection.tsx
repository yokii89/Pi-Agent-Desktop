import type { PiLocalResourceDir } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import pageStyles from "./ExtensionsPage.module.css";

interface LocalResourcesSectionProps {
  dirs: PiLocalResourceDir[];
  onOpenPath: (path: string) => void;
}

function localKindKey(kind: PiLocalResourceDir["kind"]): string {
  return `extensions.localKind.${kind}`;
}

/** 本地资源目录入口（~/.pi/agent/{extensions,skills,prompts,themes}）。 */
export function LocalResourcesSection({ dirs, onOpenPath }: LocalResourcesSectionProps) {
  const t = useT();
  if (dirs.length === 0) return null;
  return (
    <section>
      <h2 className={pageStyles.sectionTitle}>{t("extensions.localResources")}</h2>
      <div className={pageStyles.localGrid}>
        {dirs.map((dir) => (
          <div key={dir.kind} className={pageStyles.localCard}>
            <div className={pageStyles.localMeta}>
              <span className={pageStyles.localName}>{t(localKindKey(dir.kind))}</span>
              <span className={pageStyles.localPath}>{dir.path}</span>
            </div>
            <Button disabled={!dir.exists} onClick={() => onOpenPath(dir.path)}>
              {dir.exists ? t("extensions.openFolder") : t("extensions.missing")}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
