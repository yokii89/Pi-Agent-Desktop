import type { ManagedSkillDiagnostic } from "../../../shared/managedSkills";
import { useT } from "../../hooks/useT";
import styles from "./ManagedSkillsSection.module.css";

export function ManagedSkillDiagnostics({
  diagnostics,
}: {
  diagnostics: ManagedSkillDiagnostic[];
}) {
  const t = useT();
  const entries = [
    ...new Map(
      diagnostics.map((item) => [`${item.code}:${item.skill ?? ""}:${item.path ?? ""}`, item]),
    ).values(),
  ];
  if (!entries.length) return null;
  return (
    <ul className={styles.diagnostics} data-selectable-text>
      {entries.map((item) => (
        <li
          key={`${item.code}:${item.skill ?? ""}:${item.path ?? ""}`}
          className={styles[item.severity]}
        >
          <span>
            {item.skill ? `${item.skill}: ` : ""}
            {t(`skills.issue.${item.code}`)}
          </span>
          {item.path ? <code className={styles.path}>{item.path}</code> : null}
        </li>
      ))}
    </ul>
  );
}
