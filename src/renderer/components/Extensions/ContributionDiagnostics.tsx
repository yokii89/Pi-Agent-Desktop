import type { ContributionDiagnostic } from "../../../shared/contribution";
import { useT } from "../../hooks/useT";
import styles from "./ExtensionsPage.module.css";

/** 静态声明诊断独立展示，坏包不影响其它扩展的管理操作。 */
export function ContributionDiagnostics({
  diagnostics,
}: {
  diagnostics: ContributionDiagnostic[];
}) {
  const t = useT();
  if (diagnostics.length === 0) return null;
  const title = t("extensions.diagnostics.title");
  return (
    <section aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <ul className={styles.diagnostics}>
        {diagnostics.map((item) => (
          <li key={`${item.scope}:${item.packageId}:${item.field ?? ""}:${item.message}`}>
            <strong>{item.packageId}</strong>
            {item.field ? ` · ${item.field}: ` : " · "}
            {item.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
